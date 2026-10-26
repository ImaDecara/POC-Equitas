CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE client (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(150) NOT NULL,
  code varchar(80) NOT NULL UNIQUE,
  description text NULL,
  notes text NULL,
  config_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  deleted_at timestamp NULL
);

CREATE TABLE element_type (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(150) NOT NULL,
  code varchar(80) NOT NULL UNIQUE,
  description text NULL,
  notes text NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  deleted_at timestamp NULL,

  is_final boolean NOT NULL DEFAULT false,
  parent_type_id uuid NULL REFERENCES element_type(id)
);

CREATE TABLE element (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(150) NOT NULL,
  code varchar(80) NOT NULL UNIQUE,
  description text NULL,
  notes text NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  deleted_at timestamp NULL,

  path text NULL,
  element_type_id uuid NOT NULL REFERENCES element_type(id),
  parent_id uuid NULL REFERENCES element(id),
  fallback_id uuid NULL REFERENCES element(id),

  max_attempts_before_fallback integer NOT NULL DEFAULT 0,
  max_attempts_before_failure integer NOT NULL DEFAULT 3,
  interval_between_attempts_seconds integer NOT NULL DEFAULT 0
);

CREATE TABLE client_element_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES client(id),
  element_id uuid NOT NULL REFERENCES element(id),
  config_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  deleted_at timestamp NULL,

  CONSTRAINT uq_client_element_config UNIQUE (client_id, element_id)
);

CREATE TABLE log_status (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(150) NOT NULL,
  code varchar(80) NOT NULL UNIQUE,
  description text NULL,
  notes text NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  deleted_at timestamp NULL
);

CREATE TABLE log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  element_id uuid NOT NULL REFERENCES element(id),
  status_id uuid NOT NULL REFERENCES log_status(id),
  started_at timestamp NOT NULL DEFAULT now(),
  finished_at timestamp NULL,
  message text NULL,
  details_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp NOT NULL DEFAULT now()
);