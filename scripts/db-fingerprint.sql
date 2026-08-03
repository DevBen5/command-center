-- Empreinte du contenu d'une base, table par table (CC-153).
--
-- `scripts/lib/dumps.js` ne vérifie qu'un dump n'est pas TRONQUÉ (en-tête, marqueur de
-- fin, au moins un CREATE TABLE). Ça n'attrape rien d'un dump complet mais logiquement
-- inutilisable une fois restauré. La seule preuve que ce fichier n'a pas menti reste de
-- le recharger et de comparer le contenu, ligne par ligne, table par table.
--
-- Usage — JAMAIS contre `app` pour le côté restauré, voir docs/restauration-verifiee.md :
--   docker compose exec -T postgres psql -U root -d <base> -A -F',' < scripts/db-fingerprint.sql
--
-- Une ligne par table : nom, nombre de lignes, md5 agrégé de toutes les colonnes. Deux
-- bases avec le même contenu produisent une sortie byte-à-byte identique (`diff`).

DROP TABLE IF EXISTS fp;
CREATE TEMP TABLE fp (tablename text, cnt bigint, hash text);

DO $$
DECLARE
  r record;
  v_cnt bigint;
  v_hash text;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename LOOP
    -- Cast de la ligne entière en texte : couvre toutes les colonnes sans connaître le
    -- nom de la clé primaire de chaque table (deux tables, rate_limits et
    -- adonis_schema_versions, n'ont pas de colonne `id`). L'ordre par `t::text` est
    -- arbitraire mais déterministe : stable tant que le contenu ne change pas.
    EXECUTE format(
      'SELECT count(*), md5(coalesce(string_agg(md5(t::text), ''|'' ORDER BY t::text), '''')) FROM %I t',
      r.tablename
    ) INTO v_cnt, v_hash;
    INSERT INTO fp VALUES (r.tablename, v_cnt, v_hash);
  END LOOP;
END $$;

SELECT tablename, cnt, hash FROM fp ORDER BY tablename;
