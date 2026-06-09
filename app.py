#!/usr/bin/env python3
"""
╔══════════════════════════════════════════════════╗
║   Flora — Automated Plant Care System            ║
║   Python Backend  (Flask + SQLite)               ║
║                                                  ║
║   Install:  pip install flask flask-cors         ║
║   Run:      python plant_backend.py              ║
║   API:      http://localhost:5000/api            ║
╚══════════════════════════════════════════════════╝
"""

import hashlib, random, math, time, sqlite3, os, threading
from datetime import datetime, timedelta
from flask import Flask, jsonify, request, session, g
from flask_cors import CORS

# ─────────────────────────────────────────
#  App setup
# ─────────────────────────────────────────
app = Flask(__name__)
app.secret_key = "flora_secret_key_2024_change_in_production"
CORS(app, supports_credentials=True, origins=["*"])

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH  = os.path.join(BASE_DIR, "flora.db")

# ─────────────────────────────────────────
#  Database helpers
# ─────────────────────────────────────────
def get_db():
    """Return a per-request SQLite connection."""
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH, detect_types=sqlite3.PARSE_DECLTYPES)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA journal_mode=WAL")
    return g.db

@app.teardown_appcontext
def close_db(exc=None):
    db = g.pop("db", None)
    if db:
        db.close()

def init_db():
    """Create all tables and seed default admin."""
    with sqlite3.connect(DB_PATH) as db:
        db.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            username   TEXT    UNIQUE NOT NULL,
            password   TEXT    NOT NULL,
            created_at TEXT    NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS sensor_history (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            plant_id   TEXT    NOT NULL,
            moisture   REAL    NOT NULL,
            temp       REAL    NOT NULL,
            light      REAL    NOT NULL,
            health     INTEGER NOT NULL,
            health_label TEXT  NOT NULL,
            watering   INTEGER NOT NULL DEFAULT 0,
            recorded_at TEXT   NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS watering_log (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            plant_id    TEXT    NOT NULL,
            trigger_type TEXT   NOT NULL,   -- 'auto' | 'manual'
            moisture_at REAL,
            logged_at   TEXT    NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS alerts (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            plant_id   TEXT    NOT NULL,
            type       TEXT    NOT NULL,    -- 'danger' | 'watering' | 'manual'
            message    TEXT    NOT NULL,
            created_at TEXT    NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_sensor_plant  ON sensor_history(plant_id, recorded_at);
        CREATE INDEX IF NOT EXISTS idx_alerts_time   ON alerts(created_at DESC);
        """)
        # Seed default admin
        existing = db.execute("SELECT id FROM users WHERE username='admin'").fetchone()
        if not existing:
            db.execute(
                "INSERT INTO users (username, password, created_at) VALUES (?, ?, ?)",
                ("admin", hash_password("admin123"), datetime.now().isoformat())
            )
            db.commit()
            print("  ✅ Default account created:  admin / admin123")

def hash_password(pw: str) -> str:
    return hashlib.sha256(pw.encode()).hexdigest()

# ─────────────────────────────────────────
#  Plant definitions
# ─────────────────────────────────────────
PLANTS = {
    "p1": {
        "name": "Swiss Cheese Plant (Monstera Deliciosa)",
        "icon": "🌿",
        "optimal_moisture": (40, 70),
        "optimal_temp":     (18, 27),
        "optimal_light":    (300, 800),
    },
    "p2": {
        "name": "Hen and Chicks (Echeveria)",
        "icon": "🌵",
        "optimal_moisture": (15, 35),
        "optimal_temp":     (15, 30),
        "optimal_light":    (600, 1200),
    },
    "p3": {
        "name": "Peace Lily (Spathiphyllum Wallisii)",
        "icon": "🌸",
        "optimal_moisture": (50, 75),
        "optimal_temp":     (18, 25),
        "optimal_light":    (100, 400),
    },
}

# ─────────────────────────────────────────
#  Simulation engine  (runs in background)
# ─────────────────────────────────────────
class PlantSimulator:
    def __init__(self):
        self._lock    = threading.Lock()
        self._state   = {}     # pid → live sensor state
        self._tick    = 0
        self._thread  = None
        self._running = False

    def start(self):
        for pid, info in PLANTS.items():
            om = info["optimal_moisture"]
            ot = info["optimal_temp"]
            ol = info["optimal_light"]
            self._state[pid] = {
                "moisture":    random.uniform(om[0]+5, om[1]-5),
                "temp":        random.uniform(ot[0]+1, ot[1]-1),
                "light":       random.uniform(ol[0]+50, ol[1]-50),
                "watering":    False,
                "last_watered": datetime.now() - timedelta(hours=random.uniform(1, 8)),
            }
        # Prime 30 history points so charts aren't empty on first load
        for _ in range(30):
            for pid in PLANTS:
                self._advance(pid, silent=True)

        self._running = True
        self._thread  = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()
        print("  🌱 Simulation engine started")

    def _loop(self):
        while self._running:
            for pid in PLANTS:
                self._advance(pid)
            time.sleep(5)

    def _advance(self, pid: str, silent=False):
        info = PLANTS[pid]
        with self._lock:
            s = self._state[pid]
            self._tick += 1
            t = self._tick * 0.06

            om = info["optimal_moisture"]
            ot = info["optimal_temp"]
            ol = info["optimal_light"]

            # Smooth sinusoidal drift + Gaussian noise
            def gauss(mean=0, std=1):
                return random.gauss(mean, std)

            s["temp"]  = (ot[0]+ot[1])/2 + (ot[1]-ot[0])*0.35*math.sin(t*0.25) + gauss(0, .3)
            s["light"] = max(0, (ol[0]+ol[1])/2 + (ol[1]-ol[0])*0.4*math.sin(t*0.18) + gauss(0, 15))
            s["moisture"] = max(0.0, min(100.0,
                s["moisture"] - random.uniform(0.25, 0.7) + (9.0 if s["watering"] else 0.0)
            ))

            # Auto-watering trigger
            if s["moisture"] < om[0] - 10 and not s["watering"]:
                s["watering"]    = True
                s["last_watered"] = datetime.now()
                if not silent:
                    self._log_watering(pid, "auto", s["moisture"])
                    self._log_alert(pid, "watering",
                        f"💧 {info['name']} auto-watered (moisture {s['moisture']:.0f}%)")

            if s["moisture"] > om[1]:
                s["watering"] = False

            if s["moisture"] < om[0] - 18 and not silent:
                self._log_alert(pid, "danger",
                    f"⚠️ {info['name']} critically dry! ({s['moisture']:.0f}%)")

            health = self._calc_health(pid, s)
            if not silent:
                self._save_snapshot(pid, s, health)

    # ── DB writes ──────────────────────────────────
    def _save_snapshot(self, pid, s, health):
        try:
            with sqlite3.connect(DB_PATH) as db:
                db.execute(
                    "INSERT INTO sensor_history (plant_id,moisture,temp,light,health,health_label,watering,recorded_at) "
                    "VALUES (?,?,?,?,?,?,?,?)",
                    (pid, round(s["moisture"],1), round(s["temp"],1), round(s["light"],0),
                     health["score"], health["label"], int(s["watering"]),
                     datetime.now().isoformat())
                )
                # Keep last 200 rows per plant
                db.execute(
                    "DELETE FROM sensor_history WHERE plant_id=? AND id NOT IN "
                    "(SELECT id FROM sensor_history WHERE plant_id=? ORDER BY id DESC LIMIT 200)",
                    (pid, pid)
                )
        except Exception as e:
            print(f"  ⚠ snapshot error: {e}")

    def _log_watering(self, pid, trigger, moisture):
        try:
            with sqlite3.connect(DB_PATH) as db:
                db.execute(
                    "INSERT INTO watering_log (plant_id,trigger_type,moisture_at,logged_at) VALUES (?,?,?,?)",
                    (pid, trigger, round(moisture,1), datetime.now().isoformat())
                )
        except Exception as e:
            print(f"  ⚠ watering log error: {e}")

    def _log_alert(self, pid, atype, msg):
        try:
            with sqlite3.connect(DB_PATH) as db:
                db.execute(
                    "INSERT INTO alerts (plant_id,type,message,created_at) VALUES (?,?,?,?)",
                    (pid, atype, msg, datetime.now().isoformat())
                )
                db.execute("DELETE FROM alerts WHERE id NOT IN (SELECT id FROM alerts ORDER BY id DESC LIMIT 200)")
        except Exception as e:
            print(f"  ⚠ alert log error: {e}")

    # ── Health calculation ─────────────────────────
    def _calc_health(self, pid, s):
        info = PLANTS[pid]
        def sc(v, lo, hi, r): return max(0, 1 - max(0, lo-v, v-hi)/r)
        avg = (
            sc(s["moisture"], *info["optimal_moisture"], 30) +
            sc(s["temp"],     *info["optimal_temp"],     10) +
            sc(s["light"],    *info["optimal_light"],    400)
        ) / 3
        pct = round(avg * 100)
        if pct >= 75: return {"score": pct, "label": "Healthy",  "color": "#4ade80"}
        if pct >= 45: return {"score": pct, "label": "Fair",     "color": "#facc15"}
        return              {"score": pct, "label": "Critical", "color": "#f87171"}

    # ── Public API ─────────────────────────────────
    def get_current(self, pid):
        with self._lock:
            s = self._state.get(pid, {})
            h = self._calc_health(pid, s)
            return {
                "moisture": round(s.get("moisture",0), 1),
                "temp":     round(s.get("temp",0), 1),
                "light":    round(s.get("light",0), 0),
                "watering": s.get("watering", False),
                "health":   h,
                "last_watered": s.get("last_watered", datetime.now()).isoformat(),
            }

    def manual_water(self, pid):
        with self._lock:
            s = self._state[pid]
            s["watering"]     = True
            s["last_watered"] = datetime.now()
        self._log_watering(pid, "manual", self._state[pid]["moisture"])
        self._log_alert(pid, "manual",
            f"💧 Manual watering triggered for {PLANTS[pid]['name']}")


SIM = PlantSimulator()

# ─────────────────────────────────────────
#  Auth decorator
# ─────────────────────────────────────────
from functools import wraps

def login_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if not session.get("user"):
            return jsonify({"error": "Unauthorized — please log in"}), 401
        return fn(*args, **kwargs)
    return wrapper

# ─────────────────────────────────────────
#  Routes — Health
# ─────────────────────────────────────────
@app.route("/api/health")
def health():
    return jsonify({"status": "ok", "version": "3.0", "mode": "python-backend"})

# ─────────────────────────────────────────
#  Routes — Auth
# ─────────────────────────────────────────
@app.route("/api/auth/register", methods=["POST"])
def register():
    data = request.get_json() or {}
    username = data.get("username", "").strip()
    password = data.get("password", "")

    if not username or not password:
        return jsonify({"error": "Username and password are required"}), 400
    if not __import__("re").match(r"^[a-zA-Z0-9_]{3,20}$", username):
        return jsonify({"error": "Username must be 3–20 chars: letters, numbers, underscore"}), 400
    if len(password) < 4:
        return jsonify({"error": "Password must be at least 4 characters"}), 400

    db = get_db()
    if db.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone():
        return jsonify({"error": "Username already taken — please choose another"}), 409

    db.execute(
        "INSERT INTO users (username, password, created_at) VALUES (?, ?, ?)",
        (username, hash_password(password), datetime.now().isoformat())
    )
    db.commit()
    session["user"] = username
    return jsonify({"ok": True, "username": username}), 201


@app.route("/api/auth/login", methods=["POST"])
def login():
    data = request.get_json() or {}
    username = data.get("username", "").strip()
    password = data.get("password", "")

    if not username or not password:
        return jsonify({"error": "Please enter both username and password"}), 400

    db   = get_db()
    user = db.execute("SELECT * FROM users WHERE username=?", (username,)).fetchone()
    if not user:
        return jsonify({"error": "Username not found"}), 401
    if user["password"] != hash_password(password):
        return jsonify({"error": "Incorrect password — please try again"}), 401

    session["user"] = username
    return jsonify({"ok": True, "username": username, "created_at": user["created_at"]})


@app.route("/api/auth/logout", methods=["POST"])
def logout():
    session.clear()
    return jsonify({"ok": True})


@app.route("/api/auth/me")
@login_required
def me():
    db   = get_db()
    user = db.execute("SELECT username, created_at FROM users WHERE username=?", (session["user"],)).fetchone()
    if not user:
        return jsonify({"error": "User not found"}), 404
    total = db.execute("SELECT COUNT(*) as c FROM users").fetchone()["c"]
    return jsonify({
        "username":   user["username"],
        "created_at": user["created_at"],
        "total_users": total,
    })


@app.route("/api/auth/change-password", methods=["POST"])
@login_required
def change_password():
    data    = request.get_json() or {}
    cur_pw  = data.get("current_password", "")
    new_pw  = data.get("new_password", "")
    conf_pw = data.get("confirm_password", "")

    if not cur_pw or not new_pw or not conf_pw:
        return jsonify({"error": "All three fields are required"}), 400
    if len(new_pw) < 4:
        return jsonify({"error": "New password must be at least 4 characters"}), 400
    if new_pw != conf_pw:
        return jsonify({"error": "Passwords do not match"}), 400

    db   = get_db()
    user = db.execute("SELECT password FROM users WHERE username=?", (session["user"],)).fetchone()
    if user["password"] != hash_password(cur_pw):
        return jsonify({"error": "Current password is incorrect"}), 401

    db.execute("UPDATE users SET password=? WHERE username=?",
               (hash_password(new_pw), session["user"]))
    db.commit()
    return jsonify({"ok": True, "message": "Password changed successfully"})

# ─────────────────────────────────────────
#  Routes — Plants
# ─────────────────────────────────────────
@app.route("/api/plants")
@login_required
def get_plants():
    result = []
    for pid, info in PLANTS.items():
        cur = SIM.get_current(pid)
        result.append({
            "id":      pid,
            "name":    info["name"],
            "icon":    info["icon"],
            "current": cur,
            "optimal": {
                "moisture": info["optimal_moisture"],
                "temp":     info["optimal_temp"],
                "light":    info["optimal_light"],
            },
            "watering":     cur["watering"],
            "last_watered": cur["last_watered"],
        })
    return jsonify(result)


@app.route("/api/plants/<pid>")
@login_required
def get_plant(pid):
    if pid not in PLANTS:
        return jsonify({"error": "Plant not found"}), 404
    info = PLANTS[pid]
    cur  = SIM.get_current(pid)
    return jsonify({
        "id":      pid,
        "name":    info["name"],
        "icon":    info["icon"],
        "current": cur,
        "optimal": {
            "moisture": info["optimal_moisture"],
            "temp":     info["optimal_temp"],
            "light":    info["optimal_light"],
        },
    })


@app.route("/api/plants/<pid>/history")
@login_required
def get_history(pid):
    if pid not in PLANTS:
        return jsonify({"error": "Plant not found"}), 404
    limit = min(int(request.args.get("limit", 120)), 500)
    db    = get_db()
    rows  = db.execute(
        "SELECT moisture,temp,light,health,health_label,watering,recorded_at "
        "FROM sensor_history WHERE plant_id=? ORDER BY id DESC LIMIT ?",
        (pid, limit)
    ).fetchall()
    result = []
    for r in reversed(rows):
        result.append({
            "ts":        r["recorded_at"],
            "moisture":  r["moisture"],
            "temp":      r["temp"],
            "light":     r["light"],
            "watering":  bool(r["watering"]),
            "health":    {"score": r["health"], "label": r["health_label"]},
        })
    return jsonify(result)


@app.route("/api/plants/<pid>/water", methods=["POST"])
@login_required
def water_plant(pid):
    if pid not in PLANTS:
        return jsonify({"error": "Plant not found"}), 404
    SIM.manual_water(pid)
    return jsonify({"ok": True, "message": f"{PLANTS[pid]['name']} watering started"})

# ─────────────────────────────────────────
#  Routes — Alerts
# ─────────────────────────────────────────
@app.route("/api/alerts")
@login_required
def get_alerts():
    limit = min(int(request.args.get("limit", 50)), 200)
    db    = get_db()
    rows  = db.execute(
        "SELECT plant_id, type, message, created_at FROM alerts ORDER BY id DESC LIMIT ?",
        (limit,)
    ).fetchall()
    return jsonify([{
        "plant_id": r["plant_id"],
        "type":     r["type"],
        "msg":      r["message"],
        "time":     r["created_at"],
    } for r in rows])

# ─────────────────────────────────────────
#  Routes — Watering log
# ─────────────────────────────────────────
@app.route("/api/watering-log")
@login_required
def watering_log():
    limit = min(int(request.args.get("limit", 50)), 200)
    db    = get_db()
    rows  = db.execute(
        "SELECT plant_id, trigger_type, moisture_at, logged_at FROM watering_log ORDER BY id DESC LIMIT ?",
        (limit,)
    ).fetchall()
    return jsonify([{
        "plant_id":    r["plant_id"],
        "trigger":     r["trigger_type"],
        "moisture_at": r["moisture_at"],
        "time":        r["logged_at"],
    } for r in rows])

# ─────────────────────────────────────────
#  Routes — Stats (dashboard summary)
# ─────────────────────────────────────────
@app.route("/api/stats")
@login_required
def stats():
    db = get_db()
    total_waterings = db.execute("SELECT COUNT(*) as c FROM watering_log").fetchone()["c"]
    auto_waterings  = db.execute("SELECT COUNT(*) as c FROM watering_log WHERE trigger_type='auto'").fetchone()["c"]
    total_alerts    = db.execute("SELECT COUNT(*) as c FROM alerts").fetchone()["c"]
    total_users     = db.execute("SELECT COUNT(*) as c FROM users").fetchone()["c"]
    return jsonify({
        "total_waterings": total_waterings,
        "auto_waterings":  auto_waterings,
        "manual_waterings": total_waterings - auto_waterings,
        "total_alerts":    total_alerts,
        "total_users":     total_users,
        "plants_monitored": len(PLANTS),
        "uptime_since":    datetime.now().isoformat(),
    })

# ─────────────────────────────────────────
#  Routes — Users (admin info on profile)
# ─────────────────────────────────────────
@app.route("/api/users/count")
@login_required
def users_count():
    db = get_db()
    c  = db.execute("SELECT COUNT(*) as c FROM users").fetchone()["c"]
    return jsonify({"count": c})

# ─────────────────────────────────────────
#  Entry point
# ─────────────────────────────────────────
if __name__ == "__main__":
    print("\n" + "═"*52)
    print("  🌿  Flora — Plant Care System Backend")
    print("═"*52)
    print(f"  📁  Database : {DB_PATH}")
    init_db()
    SIM.start()
    print(f"  🌐  API URL  : http://localhost:5000/api")
    print(f"  📋  Endpoints:")
    print(f"        GET  /api/health")
    print(f"        POST /api/auth/login")
    print(f"        POST /api/auth/register")
    print(f"        POST /api/auth/logout")
    print(f"        POST /api/auth/change-password")
    print(f"        GET  /api/plants")
    print(f"        GET  /api/plants/<id>/history")
    print(f"        POST /api/plants/<id>/water")
    print(f"        GET  /api/alerts")
    print(f"        GET  /api/watering-log")
    print(f"        GET  /api/stats")
    print(f"  👤  Default login: admin / admin123")
    print("═"*52 + "\n")
    app.run(debug=True, port=5000, threaded=True)