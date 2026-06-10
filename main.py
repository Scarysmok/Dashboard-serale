"""
Backend FastAPI per la Dashboard Chiusure Rino Petino.

Stack:
- FastAPI + uvicorn (server)
- MongoDB (motor async driver) per persistenza utenti
- bcrypt per hash password, PyJWT per i token di sessione
- httpx per il proxy server-to-server verso Google Drive

Endpoint principali:
- /auth/register, /auth/login, /auth/refresh, /auth/logout, /auth/me
- /admin/users (richiede role=admin): list, update, delete
- /drive/list, /drive/file/{id}, /drive/image (richiedono autenticazione)

Configurazione: tutte le variabili sensibili (URI Mongo, JWT secret, API key
Google, ID cartella Drive) vengono da env vars. Vedi .env.example per la lista.
"""

import os
from datetime import datetime, timedelta, timezone
from typing import Optional
from urllib.parse import urlparse

import bcrypt
import certifi
import jwt
import httpx
from bson import ObjectId
from bson.errors import InvalidId
from fastapi import FastAPI, HTTPException, Depends, Cookie, Header, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response as FastAPIResponse
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, EmailStr, Field

# ── CONFIG (da env vars) ─────────────────────────────────────────────────
def _env(key: str, default: Optional[str] = None, required: bool = False) -> str:
    val = os.environ.get(key, default)
    if required and not val:
        raise RuntimeError(f"Variabile d'ambiente mancante: {key}")
    return val

MONGODB_URI     = _env("MONGODB_URI", required=True)
JWT_SECRET      = _env("JWT_SECRET", required=True)
GOOGLE_API_KEY  = _env("GOOGLE_API_KEY", required=True)
DRIVE_FOLDER_ID = _env("DRIVE_FOLDER_ID", required=True)
CORS_ORIGINS    = [o.strip() for o in _env("CORS_ORIGINS", "").split(",") if o.strip()]
COOKIE_SECURE   = _env("COOKIE_SECURE", "true").lower() == "true"
COOKIE_DOMAIN   = _env("COOKIE_DOMAIN")  # opzionale; lascia vuoto in produzione

# Durate token. "remember=True" estende sia access che refresh a 30 giorni.
ACCESS_TTL   = timedelta(hours=24)
REFRESH_TTL  = timedelta(days=7)
REMEMBER_TTL = timedelta(days=30)

# Whitelist host per il proxy immagini (evita di diventare proxy generico)
ALLOWED_IMAGE_HOSTS = {"assets.goaudits.com"}


# ── DATABASE ─────────────────────────────────────────────────────────────
# tlsCAFile=certifi.where() forza l'uso del bundle CA di certifi: necessario
# perché su molte distro Linux (incluse quelle di Render) i certificati di
# sistema non sono compatibili con MongoDB Atlas e l'handshake TLS fallisce.
mongo = AsyncIOMotorClient(MONGODB_URI, tlsCAFile=certifi.where())
db = mongo.get_default_database()  # nome DB preso dalla URI (es. /rino_petino_dashboard)
users_col = db["users"]
overrides_col = db["overrides"]  # correzioni manuali ai valori cassa per fileId Drive
pdf_cache_col = db["pdf_cache"]  # cache condivisa dei PDF parsati (chiave: fileId_modifiedTime)

# Campi consentiti per le correzioni manuali. Whitelist per evitare che qualcuno
# scriva campi arbitrari sul documento override.
ALLOWED_OVERRIDE_FIELDS = {
    "corrispettivo", "contanti", "pos", "cambi",
    "giftcard", "annull", "buonoE", "buonoR",
}


# ── APP ──────────────────────────────────────────────────────────────────
app = FastAPI(title="Rino Petino Dashboard Backend", version="1.0")

# CORS: include_credentials=True non funziona con allow_origins=["*"], serve
# elenco esplicito. CORS_ORIGINS deve contenere il dominio Vercel del dashboard.
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS or [],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def _startup():
    """Indici unici per evitare duplicati a livello DB. Se Mongo è irraggiungibile
    al boot non blocchiamo l'avvio del backend: logghiamo l'errore e continuiamo,
    così almeno il health check / risponde e si possono fare diagnosi."""
    try:
        await users_col.create_index("email", unique=True)
        await users_col.create_index("username", unique=True)
        # overrides: un documento per fileId. fileId è la chiave naturale (Google Drive ID).
        await overrides_col.create_index("fileId", unique=True)
        # pdf_cache: chiave naturale è "fileId_modifiedTime" così bumpa la cache
        # in automatico quando il PDF viene modificato. TTL 90 giorni: i record
        # non più attivi vengono auto-puliti dopo 3 mesi senza accessi.
        await pdf_cache_col.create_index("key", unique=True)
        await pdf_cache_col.create_index("lastAccess", expireAfterSeconds=60*60*24*90)
        print("[startup] Indici Mongo creati correttamente")
    except Exception as e:
        print(f"[startup] WARN: impossibile creare indici Mongo ({type(e).__name__}): {str(e)[:200]}")
        print("[startup] Il backend parte comunque. Verifica lo stato del cluster e la connection string.")


@app.get("/health/mongo")
async def health_mongo():
    """Diagnostica della connessione MongoDB. Utile per capire se il problema
    è il backend stesso o solo la connessione al DB."""
    try:
        # ping è il comando più leggero per verificare che Mongo risponda
        await mongo.admin.command("ping")
        # Conto utenti come secondo test (richiede auth e DB corretto)
        n = await users_col.count_documents({})
        return {"ok": True, "mongo": "connected", "users_count": n}
    except Exception as e:
        return {"ok": False, "mongo": "unreachable", "error_type": type(e).__name__, "error": str(e)[:500]}


# ── MODELLI Pydantic per validazione body ───────────────────────────────
class RegisterReq(BaseModel):
    username: str = Field(min_length=3, max_length=32)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class LoginReq(BaseModel):
    email: EmailStr
    password: str
    remember: bool = False


class UserUpdateReq(BaseModel):
    enabled: Optional[bool] = None
    # Tre ruoli:
    #  - user   → sola lettura (default per le registrazioni)
    #  - editor → può modificare le correzioni manuali (PUT/DELETE /overrides)
    #  - admin  → tutto, inclusa gestione utenti
    role: Optional[str] = Field(None, pattern="^(user|editor|admin)$")


class OverridePutReq(BaseModel):
    """Body per PUT /overrides/{file_id}.
    'fields' è un dict di campi da modificare: il valore numerico sostituisce
    quello esistente; il valore null rimuove la correzione (ripristina originale).
    Esempio: {"fields": {"contanti": 320.50, "annull": null}}"""
    fields: dict


class PdfCachePutReq(BaseModel):
    """Body per POST /pdfcache. 'data' è il record JSON parsato dal frontend.
    'key' è fileId_modifiedTime (chiave naturale che invalida quando il PDF cambia)."""
    key: str
    data: dict


# ── HELPER: password e JWT ──────────────────────────────────────────────
def _hash_pw(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt(12)).decode()


def _verify_pw(pw: str, h: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode(), h.encode())
    except Exception:
        return False


def _make_token(user_id: str, ttl: timedelta, kind: str) -> str:
    """kind = 'access' | 'refresh'. Il refresh non vale per autenticarsi alle
    risorse, solo per scambiarlo con un nuovo access via /auth/refresh."""
    payload = {
        "sub": user_id,
        "kind": kind,
        "iat": datetime.now(timezone.utc),
        "exp": datetime.now(timezone.utc) + ttl,
    }
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")


def _decode_token(token: str) -> Optional[dict]:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
    except jwt.PyJWTError:
        return None


def _serialize_user(u: dict) -> dict:
    """Espone solo i campi pubblici dell'utente. MAI password_hash."""
    return {
        "id": str(u["_id"]),
        "username": u.get("username", ""),
        "email": u.get("email", ""),
        "enabled": bool(u.get("enabled", False)),
        "role": u.get("role", "user"),
        "created_at": u.get("created_at", datetime.now(timezone.utc)).isoformat(),
    }


def _set_auth_cookies(response: Response, user_id: str, remember: bool):
    """Imposta access_token e refresh_token come cookie HttpOnly e li ritorna
    anche nel JSON così il frontend può salvarli come fallback Bearer per i
    casi in cui i cookie cross-site si perdono (Safari iOS in modalità privata)."""
    access_ttl  = REMEMBER_TTL if remember else ACCESS_TTL
    refresh_ttl = REMEMBER_TTL if remember else REFRESH_TTL
    access  = _make_token(user_id, access_ttl, "access")
    refresh = _make_token(user_id, refresh_ttl, "refresh")
    common = {
        "httponly": True,
        # 'none' richiede secure=true ma è necessario per cookie cross-site
        # (frontend Vercel + backend Render = domini diversi)
        "samesite": "none" if COOKIE_SECURE else "lax",
        "secure": COOKIE_SECURE,
        "path": "/",
    }
    if COOKIE_DOMAIN:
        common["domain"] = COOKIE_DOMAIN
    response.set_cookie("access_token",  access,  max_age=int(access_ttl.total_seconds()),  **common)
    response.set_cookie("refresh_token", refresh, max_age=int(refresh_ttl.total_seconds()), **common)
    return access, refresh


# ── DEPENDENCY: utente corrente / admin ─────────────────────────────────
async def get_current_user(
    access_token: Optional[str] = Cookie(None),
    authorization: Optional[str] = Header(None),
) -> dict:
    # Cookie ha priorità; in fallback prendo da Authorization: Bearer ...
    token = access_token
    if not token and authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Non autenticato")
    payload = _decode_token(token)
    if not payload or payload.get("kind") != "access":
        raise HTTPException(status_code=401, detail="Token non valido o scaduto")
    try:
        user = await users_col.find_one({"_id": ObjectId(payload["sub"])})
    except InvalidId:
        raise HTTPException(status_code=401, detail="Token non valido")
    if not user:
        raise HTTPException(status_code=401, detail="Utente non trovato")
    if not user.get("enabled"):
        raise HTTPException(status_code=403, detail="Account in attesa di approvazione admin")
    return user


async def get_admin(user: dict = Depends(get_current_user)) -> dict:
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Permessi insufficienti")
    return user


async def get_can_edit_overrides(user: dict = Depends(get_current_user)) -> dict:
    """Permesso per modificare le correzioni manuali (PUT/DELETE /overrides).
    Concesso a editor e admin. I 'user' base hanno sola lettura."""
    if user.get("role") not in ("editor", "admin"):
        raise HTTPException(status_code=403, detail="Solo editor e admin possono modificare i valori cassa")
    return user


# ── ROUTE: HEALTH / ROOT ────────────────────────────────────────────────
@app.get("/")
async def root():
    """Health check usato anche da Render per verificare che il servizio è up."""
    return {"ok": True, "service": "rino-petino-dashboard-backend"}


# ── ROUTE: AUTH ─────────────────────────────────────────────────────────
@app.post("/auth/register")
async def register(req: RegisterReq):
    email = req.email.lower()
    username = req.username.strip()
    existing = await users_col.find_one({"$or": [{"email": email}, {"username": username}]})
    if existing:
        raise HTTPException(status_code=400, detail="Email o username già in uso")
    user = {
        "username": username,
        "email": email,
        "password_hash": _hash_pw(req.password),
        "enabled": False,        # default: in attesa di approvazione admin
        "role": "user",
        "created_at": datetime.now(timezone.utc),
    }
    result = await users_col.insert_one(user)
    return {
        "ok": True,
        "id": str(result.inserted_id),
        "message": "Registrazione completata. In attesa di approvazione da parte dell'admin.",
    }


@app.post("/auth/login")
async def login(req: LoginReq, response: Response):
    user = await users_col.find_one({"email": req.email.lower()})
    if not user or not _verify_pw(req.password, user.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Email o password non corretti")
    if not user.get("enabled"):
        raise HTTPException(status_code=403, detail="Account in attesa di approvazione admin")
    access, refresh = _set_auth_cookies(response, str(user["_id"]), req.remember)
    return {
        "user": _serialize_user(user),
        "access_token": access,
        "refresh_token": refresh,
    }


@app.post("/auth/refresh")
async def refresh(
    response: Response,
    refresh_token: Optional[str] = Cookie(None),
    authorization: Optional[str] = Header(None),
):
    token = refresh_token
    if not token and authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Refresh token mancante")
    payload = _decode_token(token)
    if not payload or payload.get("kind") != "refresh":
        raise HTTPException(status_code=401, detail="Refresh token non valido")
    try:
        user = await users_col.find_one({"_id": ObjectId(payload["sub"])})
    except InvalidId:
        raise HTTPException(status_code=401, detail="Token non valido")
    if not user or not user.get("enabled"):
        raise HTTPException(status_code=401, detail="Utente non valido")
    access, new_refresh = _set_auth_cookies(response, str(user["_id"]), False)
    return {
        "user": _serialize_user(user),
        "access_token": access,
        "refresh_token": new_refresh,
    }


@app.post("/auth/logout")
async def logout(response: Response):
    common = {"path": "/"}
    if COOKIE_DOMAIN:
        common["domain"] = COOKIE_DOMAIN
    response.delete_cookie("access_token", **common)
    response.delete_cookie("refresh_token", **common)
    return {"ok": True}


@app.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return _serialize_user(user)


# ── ROUTE: OVERRIDES (correzioni manuali ai valori cassa) ───────────────
# Le correzioni manuali sono per-fileId (cioè per chiusura/PDF), condivise tra
# tutti gli utenti autenticati. Tracciamo chi ha fatto l'ultima modifica e
# quando, ma il dato è "del negozio" non del singolo utente.

def _serialize_override(o: dict) -> dict:
    return {
        "fileId": o.get("fileId", ""),
        "fields": o.get("fields", {}),
        "updatedBy": o.get("updatedBy", ""),
        "updatedAt": o.get("updatedAt", datetime.now(timezone.utc)).isoformat(),
    }


@app.get("/overrides")
async def list_overrides(_: dict = Depends(get_current_user)):
    """Restituisce tutte le correzioni manuali. Il frontend le indicizza per
    fileId e le applica ai record parsati dai PDF. Non sono tante (al massimo
    una per chiusura) quindi non serve paginare."""
    out = []
    async for o in overrides_col.find().sort("updatedAt", -1):
        out.append(_serialize_override(o))
    return out


@app.put("/overrides/{file_id}")
async def put_override(file_id: str, req: OverridePutReq, user: dict = Depends(get_can_edit_overrides)):
    """Upsert delle correzioni per un fileId. Merge con i campi esistenti:
    - valore numerico → sovrascrive quel campo
    - valore null    → rimuove quel campo (ripristina valore originale)
    Se dopo il merge non resta alcun campo, il documento viene eliminato."""
    if not file_id or len(file_id) > 200 or "/" in file_id:
        raise HTTPException(status_code=400, detail="fileId non valido")

    # Validazione e normalizzazione campi
    incoming: dict = {}
    for k, v in (req.fields or {}).items():
        if k not in ALLOWED_OVERRIDE_FIELDS:
            raise HTTPException(status_code=400, detail=f"Campo '{k}' non consentito")
        if v is None:
            incoming[k] = None  # marker: rimuovi
        else:
            try:
                fv = float(v)
            except (TypeError, ValueError):
                raise HTTPException(status_code=400, detail=f"Valore '{k}' non numerico")
            # No NaN o Inf — Mongo li accetta, ma rompe il frontend
            if fv != fv or fv in (float("inf"), float("-inf")):
                raise HTTPException(status_code=400, detail=f"Valore '{k}' non valido")
            incoming[k] = fv

    # Merge con override esistente
    existing = await overrides_col.find_one({"fileId": file_id})
    merged = dict((existing or {}).get("fields", {}))
    for k, v in incoming.items():
        if v is None:
            merged.pop(k, None)
        else:
            merged[k] = v

    now = datetime.now(timezone.utc)
    label = user.get("username") or user.get("email", "")

    if merged:
        await overrides_col.update_one(
            {"fileId": file_id},
            {"$set": {
                "fields": merged,
                "updatedBy": label,
                "updatedAt": now,
            }},
            upsert=True,
        )
    else:
        # Niente campi → elimino il documento, niente record vuoti
        await overrides_col.delete_one({"fileId": file_id})

    return {
        "fileId": file_id,
        "fields": merged,
        "updatedBy": label,
        "updatedAt": now.isoformat(),
    }


@app.delete("/overrides/{file_id}")
async def delete_override(file_id: str, _: dict = Depends(get_can_edit_overrides)):
    """Rimuove tutte le correzioni manuali per un fileId (reset completo)."""
    if not file_id or len(file_id) > 200 or "/" in file_id:
        raise HTTPException(status_code=400, detail="fileId non valido")
    await overrides_col.delete_one({"fileId": file_id})
    return {"ok": True}


# ── ROUTE: PDF CACHE (record parsati condivisi tra tutti gli utenti) ────
# Strategia: il frontend, dopo aver parsato un PDF (operazione costosa via
# pdf.js + regex), uploada il record qui. Tutti gli altri utenti — su qualsiasi
# device — ottengono il dato parsato in millisecondi senza riscaricare e
# riparsare il PDF. La chiave è "fileId_modifiedTime" cosi quando il PDF viene
# rimodificato in Drive la cache si invalida automaticamente.

@app.get("/pdfcache")
async def list_pdf_cache(_: dict = Depends(get_current_user)):
    """Restituisce {key: data} di tutti i PDF parsati. Aggiorna lastAccess
    per evitare che il TTL li rimuova mentre sono ancora in uso."""
    items = {}
    keys_to_touch = []
    async for doc in pdf_cache_col.find({}, {"key": 1, "data": 1}):
        items[doc["key"]] = doc.get("data") or {}
        keys_to_touch.append(doc["key"])
    # Bump lastAccess in batch (best-effort, non blocca la risposta)
    if keys_to_touch:
        try:
            now = datetime.now(timezone.utc)
            await pdf_cache_col.update_many(
                {"key": {"$in": keys_to_touch}},
                {"$set": {"lastAccess": now}},
            )
        except Exception as e:
            print(f"[pdfcache] WARN bump lastAccess: {e}")
    return items


@app.post("/pdfcache")
async def put_pdf_cache(req: PdfCachePutReq, user: dict = Depends(get_current_user)):
    """Upsert di un singolo record nella cache. Idempotente: il primo utente
    che parsa un PDF popola la cache, gli altri lo recuperano via GET."""
    if not req.key or len(req.key) > 300 or "/" in req.key:
        raise HTTPException(status_code=400, detail="key non valida")
    if not isinstance(req.data, dict):
        raise HTTPException(status_code=400, detail="data deve essere un oggetto")
    now = datetime.now(timezone.utc)
    await pdf_cache_col.update_one(
        {"key": req.key},
        {"$set": {
            "key": req.key,
            "data": req.data,
            "lastAccess": now,
            "cachedBy": user.get("username") or user.get("email", ""),
        }},
        upsert=True,
    )
    return {"ok": True, "key": req.key}


@app.delete("/pdfcache")
async def clear_pdf_cache(_: dict = Depends(get_admin)):
    """Pulisce tutta la cache parsata. Utile dopo un upgrade di schema parser
    quando i record vecchi non sono più validi. Solo admin per evitare abusi."""
    n = await pdf_cache_col.delete_many({})
    return {"ok": True, "deleted": n.deleted_count}


# ── ROUTE: ADMIN (gestione utenti) ──────────────────────────────────────
@app.get("/admin/users")
async def list_users(_: dict = Depends(get_admin)):
    """Ritorna tutti gli utenti (pending + abilitati), ordinati per data crescente decrescente."""
    out = []
    async for u in users_col.find().sort("created_at", -1):
        out.append(_serialize_user(u))
    return out


@app.put("/admin/users/{user_id}")
async def update_user(user_id: str, req: UserUpdateReq, admin: dict = Depends(get_admin)):
    fields: dict = {}
    if req.enabled is not None:
        fields["enabled"] = req.enabled
    if req.role is not None:
        fields["role"] = req.role
    if not fields:
        raise HTTPException(status_code=400, detail="Nessun campo da aggiornare")
    try:
        oid = ObjectId(user_id)
    except InvalidId:
        raise HTTPException(status_code=404, detail="Utente non trovato")
    # Sicurezza: l'admin non può togliersi i privilegi né disabilitarsi da solo
    # (rischio di restare bloccato fuori dal sistema). Vale per qualsiasi
    # demote (a user o editor) e per qualsiasi disable.
    if str(admin["_id"]) == user_id:
        if (req.role and req.role != "admin") or req.enabled is False:
            raise HTTPException(status_code=400, detail="Non puoi modificare il tuo stesso account in questo modo")
    result = await users_col.update_one({"_id": oid}, {"$set": fields})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Utente non trovato")
    user = await users_col.find_one({"_id": oid})
    return _serialize_user(user)


@app.delete("/admin/users/{user_id}")
async def delete_user(user_id: str, admin: dict = Depends(get_admin)):
    if str(admin["_id"]) == user_id:
        raise HTTPException(status_code=400, detail="Non puoi eliminare il tuo stesso account")
    try:
        oid = ObjectId(user_id)
    except InvalidId:
        raise HTTPException(status_code=404, detail="Utente non trovato")
    result = await users_col.delete_one({"_id": oid})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Utente non trovato")
    return {"ok": True}


# ── ROUTE: DRIVE PROXY ──────────────────────────────────────────────────
# Le credenziali Google (api key + folder id) restano sul backend e non
# vengono mai esposte al browser. Il frontend chiama solo questi endpoint
# autenticati e riceve i dati già "deconnessi" dalla fonte.

@app.get("/drive/list")
async def drive_list(_: dict = Depends(get_current_user)):
    """Elenca i PDF presenti nella cartella Drive configurata.
    Gestisce la paginazione automaticamente: raccoglie tutte le pagine
    finché nextPageToken non è più presente (nessun limite di file)."""
    url = "https://www.googleapis.com/drive/v3/files"
    base_params = {
        "q": f"'{DRIVE_FOLDER_ID}' in parents and mimeType='application/pdf' and trashed=false",
        "fields": "nextPageToken,files(id,name,modifiedTime)",
        "orderBy": "modifiedTime desc",
        "pageSize": 1000,          # massimo consentito da Drive API
        "key": GOOGLE_API_KEY,
    }
    all_files = []
    page_token = None
    async with httpx.AsyncClient(timeout=15.0) as client:
        while True:
            params = {**base_params}
            if page_token:
                params["pageToken"] = page_token
            r = await client.get(url, params=params)
            if r.status_code != 200:
                raise HTTPException(status_code=r.status_code, detail=f"Drive API: {r.text[:200]}")
            data = r.json()
            all_files.extend(data.get("files", []))
            page_token = data.get("nextPageToken")
            if not page_token:
                break
    return all_files


@app.get("/drive/file/{file_id}")
async def drive_file(file_id: str, _: dict = Depends(get_current_user)):
    """Scarica un PDF da Drive via endpoint pubblico uc?export=download."""
    if not file_id or len(file_id) > 100 or "/" in file_id:
        raise HTTPException(status_code=400, detail="ID file non valido")
    url = f"https://drive.google.com/uc?export=download&id={file_id}"
    async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
        r = await client.get(url)
    if r.status_code != 200:
        raise HTTPException(status_code=r.status_code, detail="Download da Drive fallito")
    return FastAPIResponse(content=r.content, media_type="application/pdf")


@app.get("/drive/image")
async def drive_image(url: str, download: Optional[str] = None, _: dict = Depends(get_current_user)):
    """Proxy per immagini originali GoAudits referenziate dai PDF.
    Whitelist degli host per non diventare proxy generico per Internet."""
    try:
        parsed = urlparse(url)
    except Exception:
        raise HTTPException(status_code=400, detail="URL non valido")
    if parsed.hostname not in ALLOWED_IMAGE_HOSTS:
        raise HTTPException(status_code=403, detail=f"Host non consentito: {parsed.hostname}")
    async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
        r = await client.get(url)
    if r.status_code != 200:
        raise HTTPException(status_code=r.status_code, detail="Download immagine fallito")
    headers = {"Cache-Control": "public, max-age=3600"}
    if download:
        # Sanitizza filename per Content-Disposition (no quote, no newline)
        safe = "".join(c for c in download if c not in '"\\\n\r')[:200] or "download.jpg"
        headers["Content-Disposition"] = f'attachment; filename="{safe}"'
    media_type = r.headers.get("content-type", "image/jpeg")
    return FastAPIResponse(content=r.content, media_type=media_type, headers=headers)
