# Zabbix fixtures

`zabbix-7.0.31.json`: real requests and answers of the JSON-RPC API of the
official Docker images `zabbix/zabbix-server-pgsql` and
`zabbix/zabbix-web-nginx-pgsql` 7.0.31 (October 2026), with a Zabbix agent 2
host ("Web server", template _Linux by Zabbix agent_) and a trapper host
("NAS") fed by `zabbix_sender`. Each entry holds the request (`method`,
`params`, never the token), the HTTP status and the answer.

The answers of a refused token (`bad_token`, `no_token`), of
`apiinfo.version` called with a token (`version_with_token`,
`version_auth_in_body`), and of `event.acknowledge` on an already
acknowledged problem (`acknowledge_again`: accepted) are real too.
`test/helpers/fakeZabbix.js` serves these hosts, triggers, problems and items.
