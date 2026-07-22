-- Exécuté par l'image postgres au tout premier démarrage, quand ./pgdata est vide
-- (docker-entrypoint-initdb.d). La base applicative vient de POSTGRES_DB ; celle-ci
-- est la base des tests (DB_DATABASE de .env.test), sans laquelle `npm test` ne peut
-- pas se connecter.
CREATE DATABASE app_test;
