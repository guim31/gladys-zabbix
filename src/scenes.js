// -----------------------------------------------------------------------------
// Scene action handlers (manifest `scene_actions`, Gladys 5.1+).
//
// "Does this host have a problem?" is already a scene condition on the device
// features. These two actions do what a condition cannot:
//   - acknowledge the problems of a host from a scene (a button of the
//     dashboard, a vocal command, a "seen" reply), with a message in their
//     Zabbix history — can be turned off in the configuration;
//   - put the problems in words for a message ("2 problems: NAS: disk
//     failing…"), across every host, added to Gladys or not.
// Both read Zabbix again when the last read is older than 15 seconds.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { highestSeverity } from './devices.js';
import { ERROR_KINDS } from './zabbix/client.js';
import { ACTION_TEXT, ERROR_TEXT, pick, severityName } from './texts.js';

const logger = createLogger({ name: 'zabbix-scenes' });

// Problems listed in the `names` output, at most (the rest is counted).
export const MAX_LISTED_PROBLEMS = 20;
// Zabbix keeps 2048 characters of an acknowledgement message.
export const MAX_MESSAGE_LENGTH = 2048;

function assertReadable(hub) {
  const language = hub.config?.language;
  if (!hub.client) {
    throw new Error(pick(ACTION_TEXT.noServer, language));
  }
  if (hub.error) {
    throw new Error(pick(ERROR_TEXT[hub.error.kind], language));
  }
}

export const SCENE_ACTIONS = {
  async acknowledge_host_problems(hub, { fields = {} }) {
    const language = hub.config?.language;
    if (!hub.client) {
      throw new Error(pick(ACTION_TEXT.noServer, language));
    }
    if (!hub.config.allowAcknowledge) {
      throw new Error(pick(ACTION_TEXT.acknowledgeDisabled, language));
    }
    await hub.refreshIfStale();
    assertReadable(hub);
    const host = hub.findHost(fields.device);
    if (!host) {
      throw new Error(pick(ACTION_TEXT.unknownHost, language));
    }
    const pending = hub.problemsOf(host.id).filter((problem) => !problem.acknowledged);
    if (pending.length === 0) {
      return { acknowledged: 0 };
    }
    const typed = typeof fields.message === 'string' ? fields.message.trim() : '';
    const message = (typed || pick(ACTION_TEXT.defaultMessage, language)).slice(
      0,
      MAX_MESSAGE_LENGTH,
    );
    try {
      await hub.client.acknowledge(
        pending.map((problem) => problem.eventId),
        message,
      );
    } catch (err) {
      logger.warn(`Acknowledging the problems of ${host.name} failed: ${err.message}`);
      if (err.kind === ERROR_KINDS.API) {
        throw new Error(pick(ACTION_TEXT.acknowledgeRefused, language), { cause: err });
      }
      throw new Error(pick(ERROR_TEXT[err.kind] ?? ERROR_TEXT.http, language), { cause: err });
    }
    logger.info(`${pending.length} problem(s) of ${host.name} acknowledged`);
    await hub.pollAll();
    return { acknowledged: pending.length };
  },

  async get_problems(hub, { fields = {} }) {
    const language = hub.config?.language;
    await hub.refreshIfStale();
    assertReadable(hub);
    let problems = hub.data.problems;
    if (fields.device) {
      const host = hub.findHost(fields.device);
      if (!host) {
        throw new Error(pick(ACTION_TEXT.unknownHost, language));
      }
      problems = hub.problemsOf(host.id);
    }
    const sorted = hub.sortedProblems(problems);
    const listed = sorted
      .slice(0, MAX_LISTED_PROBLEMS)
      .map((problem) => hub.problemLabel(problem, language));
    const highest = highestSeverity(problems);
    return {
      count: problems.length,
      unacknowledged: problems.filter((problem) => !problem.acknowledged).length,
      highest_severity: severityName(highest, language),
      highest_severity_level: highest,
      names:
        sorted.length > listed.length
          ? `${listed.join(', ')}, +${sorted.length - listed.length}`
          : listed.join(', '),
    };
  },
};
