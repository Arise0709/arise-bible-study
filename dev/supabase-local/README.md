# Local Supabase copy (development and tests only)

A small stand-in for the Supabase project: PostgreSQL 16, Supabase Auth (GoTrue), PostgREST, and Mailpit
(catches sign-in emails). The keys in `.env` are throwaway local values signed with a local secret. They are
not production keys and grant nothing outside this machine.

    cd dev/supabase-local
    docker compose --env-file .env up -d
    for f in $(ls ../../supabase/migrations/*.sql | grep -v '\.down\.sql$' | sort); do
      PGPASSWORD=local-dev-only psql -h 127.0.0.1 -p 54322 -U postgres -v ON_ERROR_STOP=1 -q -f "$f"; done
    docker compose --env-file .env restart rest
    node gateway.mjs          # http://127.0.0.1:54321, the same URL shape as a Supabase project

Then, from the repository root:

    set -a; . dev/supabase-local/.env; set +a
    SUPABASE_ANON_KEY=$ANON_KEY SUPABASE_SERVICE_ROLE_KEY=$SERVICE_KEY npm run test:cloud
    SUPABASE_ANON_KEY=$ANON_KEY SUPABASE_SERVICE_ROLE_KEY=$SERVICE_KEY node e2e/orgs.cjs

Test emails: http://127.0.0.1:54324
