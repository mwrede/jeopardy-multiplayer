-- Jeopardy Multiplayer - Supabase Schema
-- Run this in your Supabase SQL Editor

-- Games table
CREATE TABLE games (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_code       VARCHAR(6) NOT NULL UNIQUE,
    status          VARCHAR(20) NOT NULL DEFAULT 'lobby',
    current_round   SMALLINT NOT NULL DEFAULT 1,
    current_clue_id UUID,
    current_player_id UUID,
    phase           VARCHAR(30) NOT NULL DEFAULT 'lobby',
    buzz_window_open BOOLEAN NOT NULL DEFAULT FALSE,
    buzz_window_start TIMESTAMPTZ,
    settings        JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    final_category_name VARCHAR(200),
    final_clue_text     TEXT,
    final_answer        TEXT
);

CREATE UNIQUE INDEX idx_games_room_code ON games(room_code);

-- Players table
CREATE TABLE players (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    game_id         UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    name            VARCHAR(30) NOT NULL,
    score           INTEGER NOT NULL DEFAULT 0,
    is_connected    BOOLEAN NOT NULL DEFAULT TRUE,
    is_ready        BOOLEAN NOT NULL DEFAULT FALSE,
    join_order      SMALLINT NOT NULL,
    latency_ms      SMALLINT,
    final_wager     INTEGER,
    final_answer    TEXT,
    final_correct   BOOLEAN,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT unique_name_per_game UNIQUE (game_id, name),
    CONSTRAINT valid_join_order CHECK (join_order > 0)
);

CREATE INDEX idx_players_game_id ON players(game_id);

-- Add player back-reference (players exists now)
ALTER TABLE games ADD CONSTRAINT fk_current_player FOREIGN KEY (current_player_id) REFERENCES players(id) DEFERRABLE INITIALLY DEFERRED;

-- Categories table
CREATE TABLE categories (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    game_id         UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    name            VARCHAR(100) NOT NULL,
    round_number    SMALLINT NOT NULL,
    position        SMALLINT NOT NULL DEFAULT 0,

    CONSTRAINT valid_round CHECK (round_number BETWEEN 1 AND 3)
);

CREATE INDEX idx_categories_game_round ON categories(game_id, round_number);

-- Clues table
CREATE TABLE clues (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category_id     UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    value           INTEGER NOT NULL,
    question        TEXT NOT NULL,
    answer          TEXT NOT NULL,
    is_daily_double BOOLEAN NOT NULL DEFAULT FALSE,
    is_answered     BOOLEAN NOT NULL DEFAULT FALSE,
    answered_by     UUID REFERENCES players(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_clues_category ON clues(category_id);

-- Add clue back-reference (clues exists now)
ALTER TABLE games ADD CONSTRAINT fk_current_clue FOREIGN KEY (current_clue_id) REFERENCES clues(id) DEFERRABLE INITIALLY DEFERRED;

-- Buzzes table
CREATE TABLE buzzes (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    game_id           UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    clue_id           UUID NOT NULL REFERENCES clues(id) ON DELETE CASCADE,
    player_id         UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    server_timestamp  TIMESTAMPTZ NOT NULL DEFAULT now(),
    client_timestamp  DOUBLE PRECISION,
    latency_offset    SMALLINT,
    adjusted_time     TIMESTAMPTZ,
    is_winner         BOOLEAN NOT NULL DEFAULT FALSE,
    is_pass           BOOLEAN NOT NULL DEFAULT FALSE,
    answer            TEXT,
    is_correct        BOOLEAN,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT unique_buzz_per_player_clue UNIQUE (game_id, clue_id, player_id)
);

CREATE INDEX idx_buzzes_game_clue ON buzzes(game_id, clue_id);

-- Game data pool: pre-loaded clues from the TSV
CREATE TABLE clue_pool (
    id              SERIAL PRIMARY KEY,
    game_id_source  INTEGER,
    category        VARCHAR(200) NOT NULL,
    round           VARCHAR(30) NOT NULL,
    question        TEXT NOT NULL,
    answer          TEXT NOT NULL,
    value           INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_clue_pool_category ON clue_pool(category);
CREATE INDEX idx_clue_pool_round ON clue_pool(round);

-- Enable Row Level Security
ALTER TABLE games ENABLE ROW LEVEL SECURITY;
ALTER TABLE players ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE clues ENABLE ROW LEVEL SECURITY;
ALTER TABLE buzzes ENABLE ROW LEVEL SECURITY;
ALTER TABLE clue_pool ENABLE ROW LEVEL SECURITY;

-- Permissive policies (since we use anon key, keep it simple for now)
-- In production, lock these down with proper auth
CREATE POLICY "Allow all on games" ON games FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on players" ON players FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on categories" ON categories FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on clues" ON clues FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on buzzes" ON buzzes FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on clue_pool" ON clue_pool FOR ALL USING (true) WITH CHECK (true);

-- Enable realtime for game tables
ALTER PUBLICATION supabase_realtime ADD TABLE games;
ALTER PUBLICATION supabase_realtime ADD TABLE players;
ALTER PUBLICATION supabase_realtime ADD TABLE clues;

-- Function: Start a game (picks random clues, sets up board)
CREATE OR REPLACE FUNCTION start_game(p_game_id UUID)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    v_round SMALLINT := 1;
    v_cat_record RECORD;
    v_cat_id UUID;
    v_position SMALLINT := 0;
    v_values INTEGER[] := ARRAY[200, 400, 600, 800, 1000];
    v_clue_record RECORD;
    v_first_player_id UUID;
    v_daily_double_cat SMALLINT;
    v_daily_double_row SMALLINT;
BEGIN
    -- Pick 6 random categories from the pool for round 1
    FOR v_cat_record IN (
        SELECT category
        FROM clue_pool
        WHERE round = 'Jeopardy Round'
        GROUP BY category
        HAVING COUNT(*) >= 5
        ORDER BY random()
        LIMIT 6
    ) LOOP
        v_cat_id := gen_random_uuid();
        INSERT INTO categories (id, game_id, name, round_number, position)
        VALUES (v_cat_id, p_game_id, v_cat_record.category, 1, v_position);

        -- Insert 5 clues for this category
        FOR i IN 1..5 LOOP
            SELECT * INTO v_clue_record
            FROM clue_pool
            WHERE category = v_cat_record.category
              AND round = 'Jeopardy Round'
            ORDER BY random()
            LIMIT 1
            OFFSET (i - 1);

            IF v_clue_record IS NOT NULL THEN
                INSERT INTO clues (category_id, value, question, answer, is_daily_double)
                VALUES (v_cat_id, v_values[i], v_clue_record.question, v_clue_record.answer, FALSE);
            END IF;
        END LOOP;

        v_position := v_position + 1;
    END LOOP;

    -- Pick 6 random categories for round 2 (Double Jeopardy)
    v_position := 0;
    v_values := ARRAY[400, 800, 1200, 1600, 2000];
    FOR v_cat_record IN (
        SELECT category
        FROM clue_pool
        WHERE round = 'Double Jeopardy'
        GROUP BY category
        HAVING COUNT(*) >= 5
        ORDER BY random()
        LIMIT 6
    ) LOOP
        v_cat_id := gen_random_uuid();
        INSERT INTO categories (id, game_id, name, round_number, position)
        VALUES (v_cat_id, p_game_id, v_cat_record.category, 2, v_position);

        FOR i IN 1..5 LOOP
            SELECT * INTO v_clue_record
            FROM clue_pool
            WHERE category = v_cat_record.category
              AND round = 'Double Jeopardy'
            ORDER BY random()
            LIMIT 1
            OFFSET (i - 1);

            IF v_clue_record IS NOT NULL THEN
                INSERT INTO clues (category_id, value, question, answer, is_daily_double)
                VALUES (v_cat_id, v_values[i], v_clue_record.question, v_clue_record.answer, FALSE);
            END IF;
        END LOOP;

        v_position := v_position + 1;
    END LOOP;

    -- Pick a random first player
    SELECT id INTO v_first_player_id
    FROM players
    WHERE game_id = p_game_id
    ORDER BY random()
    LIMIT 1;

    -- Set 1 random Daily Double in round 1
    UPDATE clues SET is_daily_double = TRUE
    WHERE id = (
        SELECT c.id FROM clues c
        JOIN categories cat ON c.category_id = cat.id
        WHERE cat.game_id = p_game_id AND cat.round_number = 1
        ORDER BY random() LIMIT 1
    );

    -- Set 2 random Daily Doubles in round 2 (different categories)
    UPDATE clues SET is_daily_double = TRUE
    WHERE id = (
        SELECT c.id FROM clues c
        JOIN categories cat ON c.category_id = cat.id
        WHERE cat.game_id = p_game_id AND cat.round_number = 2
        ORDER BY random() LIMIT 1
    );
    UPDATE clues SET is_daily_double = TRUE
    WHERE id = (
        SELECT c.id FROM clues c
        JOIN categories cat ON c.category_id = cat.id
        WHERE cat.game_id = p_game_id AND cat.round_number = 2
          AND c.is_daily_double = FALSE
        ORDER BY random() LIMIT 1
    );

    -- Update game state
    UPDATE games
    SET status = 'active',
        phase = 'board_selection',
        current_round = 1,
        current_player_id = v_first_player_id,
        updated_at = now()
    WHERE id = p_game_id;
END;
$$;
