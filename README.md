# Zabbix for Gladys Assistant

A [Gladys Assistant](https://gladysassistant.com) integration for
[Zabbix](https://www.zabbix.com/): your monitored hosts and their problems in
Gladys, scenes that react when a problem starts or is resolved, the problems
acknowledged from a scene, and a dashboard widget of the problems in progress.

It reads the Zabbix JSON-RPC API on your local network, with an API token.

## Features

- **One device per host** (all monitored hosts, or the host groups you
  choose): available, active problems, highest severity, in maintenance, and
  up to five item values of your choice (`system.cpu.util`,
  `vm.memory.utilization`…).
- **A "Zabbix server" device**: the active problems, in total and by severity.
- **Scene triggers**: a problem starts, a problem is resolved (filters: hosts,
  severities), Zabbix no longer answers.
- **Scene actions**: acknowledge the problems of a host (with a message, can
  be turned off), read the problems (count, highest severity, list).
- **Widget**: the problems in progress, the most severe first, with the hosts
  unavailable.
- Feature names, messages and documentation in English, French, German and
  Spanish.

## Requirements

- Gladys Assistant 5.1.0 or later.
- Zabbix 5.4 or later (API tokens): 6.0 LTS and 7.0 LTS included.
- A Zabbix user with read access to the hosts to follow (and the right to
  acknowledge problems for the scene action), and an API token for it.

## Installation

1. In Gladys, open **Integrations** → **Install from GitHub** and enter the
   address of this repository: `https://github.com/guim31/gladys-zabbix` (or
   install **Zabbix** from the catalog once it is listed).
2. In **Configuration**, enter the address of the Zabbix frontend
   (`http://192.168.1.2/zabbix`, `https://zabbix.example.com`…) and the API
   token. Save, then click **Test the connection**.
3. Open the **Discover** tab and add the hosts to follow.

The user guide is in [`docs/en.md`](docs/en.md) (also in
[French](docs/fr.md), [German](docs/de.md) and [Spanish](docs/es.md)); Gladys
links it from the Configuration screen.

## How it works

Every 30 seconds by default, the integration sends a handful of API requests:
`apiinfo.version` (once an hour, without the token, as Zabbix requires),
`hostgroup.get` when host groups are configured, `host.get`, `problem.get`
(suppressed problems flagged, left out of the counts), `trigger.get` for the hosts of the problems,
and `item.get` when item keys are configured. The token goes in the
`Authorization: Bearer` header from Zabbix 6.4, in the `auth` member of the
request before. The states of the added devices are sent only when they
change (and every 6 hours), the scene events on every new or resolved
problem, added device or not. The problems already seen are kept in `/data`:
a restart neither repeats nor misses one.

## Checked on a real Zabbix

On 16/10/2026, the Docker image of the integration ran with the constraints
of the Gladys sandbox (read-only rootfs, no capability, 256 MB) against
Zabbix 7.0.31 (official Docker images, PostgreSQL), with a Zabbix agent 2
host and a trapper host fed by `zabbix_sender`: discovery, problems raised
and resolved, acknowledgement, refused token, Zabbix stopped. The answers are
kept as fixtures in [`test/fixtures/zabbix`](test/fixtures/zabbix). Zabbix
6.0 and 6.4 are covered by tests of their documented API differences.

## Limitations

- One Zabbix server per integration; problems of triggers only.
- A problem leaving the scope (host removed from the groups, trigger
  disabled) counts as resolved.
- At most 30 problem events per read.

## Development

```bash
npm ci
npm run format:check && npm run lint && npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

The tests run against the fake Gladys of the SDK and an in-memory Zabbix
(`test/helpers/fakeZabbix.js`) seeded with real answers. See
[`CLAUDE.md`](CLAUDE.md) for the project rules.

## Credits

- Started from the official
  [integration template](https://github.com/GladysAssistant/integration-template-js)
  and the [integration SDK](https://github.com/GladysAssistant/integration-sdk-js)
  of Gladys Assistant (Apache-2.0).
- The [Home Assistant Zabbix integration](https://www.home-assistant.io/integrations/zabbix/)
  (Apache-2.0) and [pyzabbix](https://github.com/lukecyca/pyzabbix) were read
  for the API calls; no code is copied from them.
- Architecture shared with
  [gladys-uptime-kuma](https://github.com/guim31/gladys-uptime-kuma).

## Disclaimer

Not affiliated with Zabbix SIA. Zabbix is a trademark of Zabbix SIA.

## License

[Apache-2.0](LICENSE)
