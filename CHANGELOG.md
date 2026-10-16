# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- One device per Zabbix host (every monitored host, or the host groups of the
  configuration): available, active problems, highest severity, in
  maintenance, and up to five item values chosen by key.
- A "Zabbix server" device: the active problems, in total and by severity.
- Scene triggers: a problem starts, a problem is resolved (filters by host and
  severity), Zabbix no longer answers.
- Scene actions: acknowledge the problems of a host with a message (can be
  turned off in the configuration), read the problems for a message.
- Dashboard widget: the problems in progress, the most severe first, the
  problems not acknowledged and the hosts unavailable.
- Zabbix 5.4 to 7.x with an API token; feature names, messages and
  documentation in English, French, German and Spanish.

[Unreleased]: https://github.com/guim31/gladys-zabbix/commits/main
