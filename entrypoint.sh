#!/bin/sh
# Fix ownership of bind-mounted directories so the node user can write to them,
# then drop privileges and exec the actual server process.
chown -R node:node /app/data /app/servers 2>/dev/null || true
exec su-exec node node app.js
