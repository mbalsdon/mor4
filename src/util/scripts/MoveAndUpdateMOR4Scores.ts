import DatabaseManager from '../../DatabaseManager.js';
import OsuWrapper from '../../OsuWrapper.js';
import { MORScoreKey, defined, osuScoreToMORScore } from '../Common.js';
import MORConfig from '../MORConfig.js';

if (process.argv.length < 4) {
    throw new TypeError('Must supply .db filepaths! Example: npm run move_and_update_mor4_scores ./data/old.db ./data/new.db');
}

const dbOldFilepath = process.argv[2] as string;
const dbNewFilepath = process.argv[3] as string;
console.info(`MoveAndUpdateMOR4Scores - moving scores from "${dbOldFilepath}" to "${dbNewFilepath}"... This will take a really long time!`);

const startTimeMs = new Date(Date.now()).getTime();

const dbmOld = new DatabaseManager(dbOldFilepath);
const dbmNew = new DatabaseManager(dbNewFilepath);
const osu = await OsuWrapper.build();

const numScores = await dbmOld.getNumScores();
const cooldownHrs = MORConfig.OSU_API_COOLDOWN_MS / 3600000;
let minimumHrsRemaining = numScores * cooldownHrs;
let numCompleted = 0;

const scores = await dbmOld.getScores();
const scoreIDs = scores.map((s) => s[MORScoreKey.SCORE_ID]);

for (const scoreID of scoreIDs) {
    console.info(`MoveAndUpdateMOR4Scores - updating score ${scoreID}... (${numCompleted}/${numScores}, minimum time remaining = ${minimumHrsRemaining.toFixed(2)} hours)`);

    // FIXME: Add pre-API-call check if score already in new DB (saves time if the script got cancelled)
    const osuScore = await osu.getScore(scoreID.toString());
    if (!defined(osuScore)) {
        console.info(`MoveAndUpdateMOR4Scores - osu!API could not find score ${scoreID}; skipping...`);
    } else {
        const dbScore = await osuScoreToMORScore(osu, osuScore);
        await dbmNew.insertScore(dbScore);
    }

    minimumHrsRemaining = minimumHrsRemaining - cooldownHrs;
    ++numCompleted;
}

const endTimeMs = new Date(Date.now()).getTime();
const durationHrs = (endTimeMs - startTimeMs) / 3600000;

console.info(`MoveAndUpdateMOR4Scores - finished moving ${numScores} scores! Duration = ${durationHrs.toFixed(2)} hours.`);
