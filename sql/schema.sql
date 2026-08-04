-- CX-View V1.3 — Schéma complet
CREATE TABLE IF NOT EXISTS cx_users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT 'Utilisateur',
  role TEXT NOT NULL DEFAULT 'ADMIN' CHECK (role IN ('SUPER_ADMIN','ADMIN','CLIENT')),
  client_id INTEGER,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cx_clients (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  contact_email TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE cx_users DROP CONSTRAINT IF EXISTS cx_users_client_fk;
ALTER TABLE cx_users ADD CONSTRAINT cx_users_client_fk FOREIGN KEY (client_id) REFERENCES cx_clients(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS cx_folders (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  client_id INTEGER REFERENCES cx_clients(id) ON DELETE CASCADE,
  parent_id INTEGER REFERENCES cx_folders(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cx_media (
  id SERIAL PRIMARY KEY,
  client_id INTEGER REFERENCES cx_clients(id) ON DELETE SET NULL,
  folder_id INTEGER REFERENCES cx_folders(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  file_name TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  media_type TEXT NOT NULL CHECK (media_type IN ('IMAGE','VIDEO')),
  bytes BIGINT NOT NULL DEFAULT 0,
  duration_seconds INTEGER,
  thumbnail_name TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED','PENDING_DELETE')),
  keep_forever BOOLEAN NOT NULL DEFAULT FALSE,
  last_used_at TIMESTAMPTZ,
  delete_after TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cx_playlists (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  client_id INTEGER REFERENCES cx_clients(id) ON DELETE SET NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cx_playlist_items (
  id SERIAL PRIMARY KEY,
  playlist_id INTEGER NOT NULL REFERENCES cx_playlists(id) ON DELETE CASCADE,
  item_type TEXT NOT NULL DEFAULT 'MEDIA' CHECK (item_type IN ('MEDIA','WIDGET')),
  media_id INTEGER REFERENCES cx_media(id) ON DELETE CASCADE,
  widget_type TEXT CHECK (widget_type IN ('CLOCK','WEATHER','COUNTDOWN','TICKER','QRCODE','WEBPAGE','RSS')),
  widget_config JSONB DEFAULT '{}',
  position INTEGER NOT NULL DEFAULT 0,
  duration_seconds INTEGER NOT NULL DEFAULT 10,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  is_priority BOOLEAN NOT NULL DEFAULT FALSE,
  priority_interval_minutes INTEGER,
  priority_count INTEGER DEFAULT 1,
  schedule_start TIMESTAMPTZ,
  schedule_end TIMESTAMPTZ,
  schedule_days TEXT DEFAULT 'all',
  schedule_time_from TIME,
  schedule_time_to TIME,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cx_screens (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  client_id INTEGER REFERENCES cx_clients(id) ON DELETE SET NULL,
  pairing_code TEXT NOT NULL UNIQUE,
  width_px INTEGER NOT NULL DEFAULT 1920,
  height_px INTEGER NOT NULL DEFAULT 1080,
  orientation INTEGER NOT NULL DEFAULT 0 CHECK (orientation IN (0,90,180,270)),
  layout TEXT NOT NULL DEFAULT 'SINGLE' CHECK (layout IN ('SINGLE','VERTICAL','HORIZONTAL')),
  playlist_a_id INTEGER REFERENCES cx_playlists(id) ON DELETE SET NULL,
  playlist_b_id INTEGER REFERENCES cx_playlists(id) ON DELETE SET NULL,
  standby_color TEXT NOT NULL DEFAULT '#000000',
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cx_logs (
  id SERIAL PRIMARY KEY,
  screen_id INTEGER REFERENCES cx_screens(id) ON DELETE CASCADE,
  media_id INTEGER REFERENCES cx_media(id) ON DELETE SET NULL,
  playlist_id INTEGER REFERENCES cx_playlists(id) ON DELETE SET NULL,
  zone TEXT DEFAULT 'A',
  event TEXT NOT NULL DEFAULT 'PLAYED',
  played_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cx_sessions (
  sid TEXT PRIMARY KEY,
  sess JSONB NOT NULL,
  expire TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cx_media_client ON cx_media(client_id);
CREATE INDEX IF NOT EXISTS idx_cx_media_folder ON cx_media(folder_id);
CREATE INDEX IF NOT EXISTS idx_cx_media_status ON cx_media(status);
CREATE INDEX IF NOT EXISTS idx_cx_playlist_items ON cx_playlist_items(playlist_id, position);
CREATE INDEX IF NOT EXISTS idx_cx_screens_client ON cx_screens(client_id);
CREATE INDEX IF NOT EXISTS idx_cx_logs_screen ON cx_logs(screen_id, played_at);
CREATE INDEX IF NOT EXISTS idx_cx_logs_media ON cx_logs(media_id);
CREATE INDEX IF NOT EXISTS idx_cx_sessions_expire ON cx_sessions(expire);
