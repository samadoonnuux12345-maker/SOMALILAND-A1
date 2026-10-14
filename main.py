

from flask import (
    Flask,
    render_template,
    request,
    jsonify,
    send_from_directory,
    Response,
    stream_with_context
)
from pathlib import Path
from werkzeug.utils import secure_filename
import requests
import json
import uuid
from datetime import datetime, timezone

app = Flask(__name__)

OLLAMA_URL = "http://127.0.0.1:11434"
DEFAULT_MODEL = "qwen2.5vl:3b"

# Local storage: data stays on this computer
DATA_DIR = Path(app.root_path) / "data"
LIBRARY_DIR = DATA_DIR / "library"
CHATS_FILE = DATA_DIR / "chats.json"

DATA_DIR.mkdir(exist_ok=True)
LIBRARY_DIR.mkdir(exist_ok=True)

ALLOWED_EXTENSIONS = {
    "txt", "pdf", "png", "jpg", "jpeg", "gif",
    "webp", "docx", "csv", "md"
}


def read_chats():
    try:
        if CHATS_FILE.exists():
            data = json.loads(CHATS_FILE.read_text(encoding="utf-8"))
            return data if isinstance(data, list) else []
    except (OSError, json.JSONDecodeError):
        pass
    return []


def write_chats(chats):
    temporary = CHATS_FILE.with_suffix(".tmp")
    temporary.write_text(
        json.dumps(chats, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )
    temporary.replace(CHATS_FILE)


@app.route("/")
def index():
    return render_template("index.html")


# ---------- OLLAMA ----------

@app.route("/api/health")
def health():
    try:
        r = requests.get(f"{OLLAMA_URL}/api/tags", timeout=3)
        r.raise_for_status()
        return jsonify({"ok": True, "status": "online"})
    except requests.RequestException:
        return jsonify({
            "ok": False,
            "status": "offline",
            "message": "Start Ollama, then refresh this page."
        }), 503


@app.route("/api/models")
def models():
    try:
        r = requests.get(f"{OLLAMA_URL}/api/tags", timeout=10)
        r.raise_for_status()
        names = [m["name"] for m in r.json().get("models", [])]
        return jsonify({"models": names, "default": DEFAULT_MODEL})
    except requests.RequestException as e:
        return jsonify({
            "models": [],
            "default": DEFAULT_MODEL,
            "error": str(e)
        }), 503


@app.route("/api/chat", methods=["POST"])
def chat():
    data = request.get_json(silent=True) or {}
    model = data.get("model") or DEFAULT_MODEL
    incoming = data.get("messages", [])

    if not isinstance(incoming, list) or not incoming:
        return jsonify({"error": "Please enter a message."}), 400

    cleaned = []

    for item in incoming[-30:]:
        if not isinstance(item, dict):
            continue

        role = item.get("role")
        content = item.get("content", "")

        if role not in ("user", "assistant", "system"):
            continue
        if not isinstance(content, str):
            continue

        message = {"role": role, "content": content[:12000]}

        images = item.get("images", [])
        if role == "user" and isinstance(images, list):
            valid_images = [
                img for img in images[:2]
                if isinstance(img, str) and len(img) <= 12_000_000
            ]
            if valid_images:
                message["images"] = valid_images

        cleaned.append(message)

    if not cleaned:
        return jsonify({"error": "No valid messages provided."}), 400

    payload = {
        "model": model,
        "messages": cleaned,
        "stream": True
    }

    def generate():
        try:
            with requests.post(
                f"{OLLAMA_URL}/api/chat",
                json=payload,
                stream=True,
                timeout=(10, 300)
            ) as response:
                response.raise_for_status()

                for line in response.iter_lines():
                    if not line:
                        continue

                    packet = json.loads(line.decode("utf-8"))
                    token = packet.get("message", {}).get("content", "")

                    if token:
                        yield json.dumps({
                            "type": "token",
                            "token": token
                        }) + "\n"

                    if packet.get("done"):
                        yield json.dumps({"type": "done"}) + "\n"

        except requests.RequestException as e:
            yield json.dumps({
                "type": "error",
                "error": (
                    "Cannot connect to Ollama. Make sure Ollama is running "
                    "and the model is installed. Details: " + str(e)
                )
            }) + "\n"
        except Exception as e:
            yield json.dumps({
                "type": "error",
                "error": str(e)
            }) + "\n"

    return Response(
        stream_with_context(generate()),
        content_type="application/x-ndjson; charset=utf-8"
    )


# ---------- CHAT HISTORY ----------

@app.route("/api/chats", methods=["GET"])
def list_chats():
    chats = read_chats()
    summaries = [
        {
            "id": c.get("id"),
            "title": c.get("title", "New chat"),
            "updated_at": c.get("updated_at", "")
        }
        for c in chats
    ]
    summaries.sort(
        key=lambda c: c.get("updated_at", ""),
        reverse=True
    )
    return jsonify({"chats": summaries})


@app.route("/api/chats", methods=["POST"])
def save_chat():
    data = request.get_json(silent=True) or {}
    messages = data.get("messages", [])

    if not isinstance(messages, list):
        return jsonify({"error": "Messages must be a list."}), 400

    # Keep only ordinary chat text in saved history.
    safe_messages = []
    for message in messages[-100:]:
        if not isinstance(message, dict):
            continue
        role = message.get("role")
        content = message.get("content", "")
        if role not in ("user", "assistant", "system"):
            continue
        if not isinstance(content, str):
            continue
        safe_messages.append({
            "role": role,
            "content": content[:12000]
        })

    chat_id = str(data.get("id") or uuid.uuid4())
    title = data.get("title") or "New chat"
    title = str(title)[:120]

    chats = read_chats()
    existing = next(
        (c for c in chats if c.get("id") == chat_id),
        None
    )

    record = {
        "id": chat_id,
        "title": title,
        "messages": safe_messages,
        "updated_at": datetime.now(timezone.utc).isoformat()
    }

    if existing:
        chats = [
            record if c.get("id") == chat_id else c
            for c in chats
        ]
    else:
        chats.append(record)

    write_chats(chats)
    return jsonify({"ok": True, "chat": record})


@app.route("/api/chats/<chat_id>", methods=["GET"])
def get_chat(chat_id):
    chat_record = next(
        (c for c in read_chats() if c.get("id") == chat_id),
        None
    )
    if not chat_record:
        return jsonify({"error": "Chat not found."}), 404
    return jsonify({"chat": chat_record})


@app.route("/api/chats/<chat_id>", methods=["DELETE"])
def delete_chat(chat_id):
    chats = read_chats()
    remaining = [c for c in chats if c.get("id") != chat_id]

    if len(remaining) == len(chats):
        return jsonify({"error": "Chat not found."}), 404

    write_chats(remaining)
    return jsonify({"ok": True})


# ---------- LOCAL LIBRARY ----------

@app.route("/api/library", methods=["GET"])
def list_library():
    files = []
    for path in LIBRARY_DIR.iterdir():
        if path.is_file():
            files.append({
                "name": path.name,
                "size": path.stat().st_size
            })
    files.sort(key=lambda f: f["name"].lower())
    return jsonify({"files": files})


@app.route("/api/library", methods=["POST"])
def upload_library_file():
    uploaded = request.files.get("file")

    if not uploaded or not uploaded.filename:
        return jsonify({"error": "Choose a file first."}), 400

    filename = secure_filename(uploaded.filename)
    if not filename or "." not in filename:
        return jsonify({"error": "Invalid filename."}), 400

    extension = filename.rsplit(".", 1)[1].lower()
    if extension not in ALLOWED_EXTENSIONS:
        return jsonify({
            "error": "File type not supported."
        }), 400

    # Avoid overwriting another file with the same name.
    destination = LIBRARY_DIR / filename
    if destination.exists():
        stem = destination.stem
        suffix = destination.suffix
        destination = LIBRARY_DIR / f"{stem}_{uuid.uuid4().hex[:8]}{suffix}"

    uploaded.save(destination)
    return jsonify({
        "ok": True,
        "name": destination.name,
        "size": destination.stat().st_size
    })
    from flask import send_from_directory

@app.route('/favicon.ico')
def favicon():
    return send_from_directory(
        app.static_folder,
        'favicon.ico',
        mimetype='image/vnd.microsoft.icon'
    )


@app.route("/api/library/<path:filename>", methods=["DELETE"])
def delete_library_file(filename):
    safe_name = secure_filename(filename)
    if not safe_name or safe_name != filename:
        return jsonify({"error": "Invalid filename."}), 400

    target = LIBRARY_DIR / safe_name
    if not target.is_file():
        return jsonify({"error": "File not found."}), 404

    target.unlink()
    return jsonify({"ok": True})


if __name__ == "__main__":
    print("\n✦ SOMALILAND AI")
    print("Open http://127.0.0.1:5000")
    app.run(host="127.0.0.1", port=5000, debug=True)
