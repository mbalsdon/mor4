import DatabaseManager from '../../DatabaseManager.js';
import OsuWrapper from '../../OsuWrapper.js';
import { MORUser, MORUserKey, defined } from '../Common.js';

if (process.argv.length < 4) {
    throw new TypeError('Must supply .db filepaths! Example: npm run move_and_update_mor4_users ./data/old.db ./data/new.db');
}

const dbOldFilepath = process.argv[2] as string;
const dbNewFilepath = process.argv[3] as string;
console.info(`MoveAndUpdateMOR4Users - moving users from "${dbOldFilepath}" to "${dbNewFilepath}"...`);

const startTimeMs = new Date(Date.now()).getTime();

const dbmOld = new DatabaseManager(dbOldFilepath);
const dbmNew = new DatabaseManager(dbNewFilepath);
const osu = await OsuWrapper.build();

const users = await dbmOld.getUsers();

for (let i = 0; i < users.length; i += 50) {
    const userIDChunk = users.map((u) => u[MORUserKey.USER_ID].toString()).slice(i, i + 50);
    const response = await osu.getUsers(userIDChunk);
    const osuUserChunk = response.users;

    for (const osuUser of osuUserChunk) {
        const dbUser = users.find((u) => u[MORUserKey.USER_ID] === osuUser.id);
        if (!defined(dbUser)) {
            console.error(`MoveAndUpdateMOR4Users - could not find user ${osuUser.id} in "${dbmOld.filename}" - skipping... This should never happen!`);
            continue;
        }

        const updatedUser: MORUser = {
            [MORUserKey.USER_ID]: osuUser.id,
            [MORUserKey.USERNAME]: osuUser.username,
            [MORUserKey.COUNTRY_CODE]: osuUser.country_code,
            [MORUserKey.GLOBAL_RANK]: osuUser.statistics_rulesets.osu.global_rank,
            [MORUserKey.PP]: osuUser.statistics_rulesets.osu.pp,
            [MORUserKey.ACCURACY]: osuUser.statistics_rulesets.osu.hit_accuracy,
            [MORUserKey.PLAYTIME]: osuUser.statistics_rulesets.osu.play_time,
            [MORUserKey.PLAYCOUNT]: osuUser.statistics_rulesets.osu.play_count,
            [MORUserKey.RANKED_SCORE]: osuUser.statistics_rulesets.osu.ranked_score,
            [MORUserKey.MAX_COMBO]: osuUser.statistics_rulesets.osu.maximum_combo,
            [MORUserKey.REPLAYS_WATCHED]: osuUser.statistics_rulesets.osu.replays_watched_by_others,
            [MORUserKey.PFP_IMAGE_URL]: osuUser.avatar_url,
            [MORUserKey.TOP_1S]: (dbUser as MORUser)[MORUserKey.TOP_1S],
            [MORUserKey.TOP_2S]: (dbUser as MORUser)[MORUserKey.TOP_2S],
            [MORUserKey.TOP_3S]: (dbUser as MORUser)[MORUserKey.TOP_3S],
            [MORUserKey.AUTOTRACK]: (dbUser as MORUser)[MORUserKey.AUTOTRACK]
        };

        console.info(`MoveAndUpdateMOR4Users - updating user ${osuUser.id}...`);
        await dbmNew.insertUser(updatedUser);
    }
}

const endTimeMs = new Date(Date.now()).getTime();
const durationMin = (endTimeMs - startTimeMs) / 60000;

console.info(`MoveAndUpdateMOR4Scores - finished moving users! Duration = ${durationMin.toFixed(2)} minutes.`);
