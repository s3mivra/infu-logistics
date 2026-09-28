#!/bin/bash
# Healthcheck for the shared mongod: initiates the replica set on first boot,
# then reports its status. Logs in as root when MONGO_AUTH=on.
EVAL="try { rs.status().ok } catch (e) { rs.initiate({_id:'rs0',members:[{_id:0,host:'mongo:27017'}]}).ok }"
if [ "${MONGO_AUTH:-off}" = "on" ]; then
  exec mongosh "mongodb://${MONGO_ROOT_USER:-root}:${MONGO_ROOT_PASSWORD}@localhost:27017/admin?directConnection=true" --quiet --eval "$EVAL"
fi
exec mongosh --quiet --eval "$EVAL"
