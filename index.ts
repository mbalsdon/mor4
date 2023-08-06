import Bot from './src/Bot.js';
import MORConfig from './src/util/MORConfig.js';
import DatabaseUpdater from './src/DatabaseUpdater.js';
import JobManager from './src/JobManager.js';
import { MORJob, MORJobKey } from './src/util/Common.js';

const bot = await Bot.build(MORConfig.DB_FILEPATH);
await bot.start();

const dbu = await DatabaseUpdater.build(MORConfig.DB_FILEPATH);
const jm = new JobManager();

// Run at 00:00 (2001-09-08 00:00, 2001-09-09 00:00, 2001-09-10 00:00, ...)
const removeDuplicateScores: MORJob = {
    [MORJobKey.NAME]: 'removeDuplicateScores',
    [MORJobKey.RULE]: '0 0 * * *',
    [MORJobKey.CALLBACK]: async () => {
        await dbu.removeDuplicateScores();
    }
};

// Run at minute 30 past every hour (01:30, 02:30, 03:30, ...)
const getNewScores: MORJob = {
    [MORJobKey.NAME]: 'getNewScores',
    [MORJobKey.RULE]: '30 */1 * * *',
    [MORJobKey.CALLBACK]: async () => {
        await dbu.getNewScores();
    }
};

// Run every 3 minutes (01:00, 01:03, 01:06, ...)
const updateUsers: MORJob = {
    [MORJobKey.NAME]: 'updateUsers',
    [MORJobKey.RULE]: '*/3 * * * *',
    [MORJobKey.CALLBACK]: async () => {
        await dbu.updateUsers();
    }
};

jm.addJob(getNewScores);
jm.addJob(removeDuplicateScores);
jm.addJob(updateUsers);
jm.start();
