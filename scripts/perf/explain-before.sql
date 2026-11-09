-- Igual que explain.sql, pero sin los índices de la migración de rendimiento
-- (se quitan dentro de una transacción que se deshace al final): así el mismo
-- run muestra el "antes" y el "después".
\set ON_ERROR_STOP on
begin;
-- (sin índices nuevos todavía)
\ir explain.sql
rollback;
