import { MORMod, MORUserKey, MORScoreKey, OsuScoreType, MORScore, defined, MORUser, osuScoreToMORScore, convertOsuMods } from './util/Common.js';
import DatabaseManager from './DatabaseManager.js';
import OsuWrapper from './OsuWrapper.js';
import MORConfig from './util/MORConfig.js';

import { readFileSync, PathOrFileDescriptor } from 'fs';
import { extname } from 'path';

import './util/Logger.js';
import { loggers } from 'winston';
const logger = loggers.get('logger');

/**
 * Updates local database with osu! data.
 */
export default class DatabaseUpdater {
    private _dbm: DatabaseManager;
    private _osu: OsuWrapper;

    /* ------------------------------------------------------------------------------------------------------------------------------------ */
    /* ---------------------------------------------------------------PUBLIC--------------------------------------------------------------- */
    /* ------------------------------------------------------------------------------------------------------------------------------------ */

    /**
     * Build osu! client and construct DatabaseUpdater for given database file.
     * @param {string} filename
     * @returns {Promise<DatabaseUpdater>}
     */
    public static async build (filename: string): Promise<DatabaseUpdater> {
        logger.debug(`DatabaseUpdater::build - building DatabaseUpdater instance for "${filename}"...`);

        const osu = await OsuWrapper.build();
        return new DatabaseUpdater(filename, osu);
    }

    /**
     * Take top/recent/first/pinned scores of each tracked user and insert them into database.
     * @returns {Promise<void>}
     */
    public async getNewScores (): Promise<void> {
        logger.info('DatabaseUpdater::getNewScores - collecting plays from tracked users and inserting into database... This may take a while!');

        const startTimeMs = new Date(Date.now()).getTime();
        const startNumScores = await this._dbm.getNumScores();

        const userIDs = await this._dbm.getAutotrackUserIDs();
        for (const userID of userIDs) {
            logger.info(`DatabaseUpdater::getNewScores - retrieving scores for user ${userID}...`);

            const userIDString = userID.toString();
            const userTops = await this._osu.getUserScores(userIDString, OsuScoreType.BEST);
            const userFirsts = await this._osu.getUserScores(userIDString, OsuScoreType.FIRST);
            const userRecents = await this._osu.getUserScores(userIDString, OsuScoreType.RECENT);
            const userPinned = await this._osu.getUserScores(userIDString, OsuScoreType.PINNED);

            for (const userScore of [ ...userTops, ...userFirsts, ...userRecents, ...userPinned ]) {
                // RX plays on lazer get submitted (but not worth pp) as of 16/05/2024.
                // FUTURE: Code avoids all non-registered MORMods (such as RX). Becomes problematic if new pp-rewarding mods get added in the future.
                let scoreExists;
                try {
                    scoreExists = await this._dbm.scoreExistsInTable(userScore.id, convertOsuMods(userScore.mods));
                } catch (error) {
                    if (error instanceof TypeError) {
                        logger.warn(`DatabaseUpdater::getNewScores - score ${userScore.id} has mods ${userScore.mods}, which have no MORMod equivalent; skipping...`);
                        return;
                    }
                }

                if (!scoreExists) {
                    const dbScore = await osuScoreToMORScore(this._osu, userScore);
                    await this._dbm.insertScore(dbScore);
                } else {
                    logger.debug(`DatabaseUpdater::getNewScores - score ${userScore.id} already exists in database; skipping...`);
                }
            }
        }

        const endNumScores = await this._dbm.getNumScores();
        const numInserted = endNumScores - startNumScores;
        const endTimeMs = new Date(Date.now()).getTime();
        const durationMin = (endTimeMs - startTimeMs) / 60000;

        logger.info(`DatabaseUpdater::getNewScores - successfully updated database with new scores! Inserted ${numInserted} plays. Duration = ${durationMin.toFixed(2)} minutes.`);
        return;
    }

    /**
     * Remove duplicate scores from database; instances are observed where score is submitted twice (but with different score IDs)
     * FUTURE: Verify if this is still necessary as it may get fixed in the API.
     * @returns {Promise<void>}
     */
    public async removeDuplicateScores (): Promise<void> {
        logger.info('DatabaseUpdater::removeDuplicateScores - removing duplicate scores... This may take a while!');

        const startTimeMs = new Date(Date.now()).getTime();
        let numRemoved = 0;

        for (const key in MORMod) {
            const scores = await this._dbm.getDuplicateScores(key);
            for (const dbScore of scores) {
                const osuScore = await this._osu.getScore(dbScore[MORScoreKey.SCORE_ID].toString());

                // API doesn't store the score - remove it.
                // NOTE: If both instances of duplicate score can't be found, both are removed. This can happen if a player
                //       overwrites the duplicated score with a better score (osu!API only stores the best play). This is
                //       okay though since we want to remove overwritten scores anyways.
                if (!defined(osuScore)) {
                    logger.info(`DatabaseUpdater::removeDuplicateScores - osu!API could not find ${key} score ${dbScore[MORScoreKey.SCORE_ID]}; removing...`);
                    await this._dbm.removeScore(dbScore[MORScoreKey.SCORE_ID], key);
                    ++numRemoved;
                    continue;
                }

                // API-stored score is different - remove it.
                // NOTE: Want to be careful here - what if it isn't different, but looks that way due to PP/SR/etc. changes?
                //       Only check date for that reason. Idek why this was happening in the first place - lazer breaks everything.
                if (dbScore[MORScoreKey.DATE] !== osuScore.created_at) {
                    logger.info(`DatabaseUpdater::removeDuplicateScores - osu!API and DB diverge for ${key} score ${dbScore[MORScoreKey.SCORE_ID]}; removing...`);
                    await this._dbm.removeScore(dbScore[MORScoreKey.SCORE_ID], key);
                    ++numRemoved;
                    continue;
                }
            }
        }

        const endTimeMs = new Date(Date.now()).getTime();
        const durationMin = (endTimeMs - startTimeMs) / 60000;

        logger.info(`DatabaseUpdater::removeDuplicateScores - found and removed ${numRemoved} duplicate scores. Duration = ${durationMin.toFixed(2)} minutes.`);
        return;
    }

    /**
     * Update each score in database by re-retrieving from osu!API.
     * Should be used after PP reworks. Also removes any overwritten scores.
     * Recommendations:
     *  1. Create a backup of the database before running.
     *  2. If you are running the Bot / JobsHandler, run this on a separate thread.
     *  3. Set OSU_API_COOLDOWN_MS to 1000 or higher so as to not overload the osu!API.
     *  4. Set LOG_LEVEL to info to prevent log spam.
     * @returns {Promise<void>}
     */
    public async updateScores (): Promise<void> {
        logger.info('DatabaseUpdater::updateScores - updating all scores in the database... This will take a really long time!');

        const startTimeMs = new Date(Date.now()).getTime();

        const numScores = await this._dbm.getNumScores();
        const cooldownHrs = MORConfig.OSU_API_COOLDOWN_MS / 3600000;
        let minimumHrsRemaining = numScores * cooldownHrs;
        let numCompleted = 0;

        for (const key in MORMod) {
            logger.info(`DatabaseUpdater::updateScores - updating ${key} scores...`);
            const scores = await this._dbm.getTableScores(key);

            for (const score of scores) {
                const scoreID = score[MORScoreKey.SCORE_ID];
                logger.info(`DatabaseUpdater::updateScores - updating ${key} score ${scoreID}... (${numCompleted}/${numScores}, minimum time remaining = ${minimumHrsRemaining.toFixed(2)} hours)`);

                const updatedScore = await this._osu.getScore(scoreID.toString());
                if (!defined(updatedScore)) {
                    logger.info(`DatabaseUpdater::updateScores - osu!API could not find ${key} score ${scoreID}; removing...`);
                    await this._dbm.removeScore(scoreID, key);
                } else {
                    const dbScore = await osuScoreToMORScore(this._osu, updatedScore);
                    await this._dbm.updateScore(dbScore);
                }

                minimumHrsRemaining = minimumHrsRemaining - cooldownHrs;
                ++numCompleted;
            }
        }

        const endTimeMs = new Date(Date.now()).getTime();
        const durationHrs = (endTimeMs - startTimeMs) / 3600000;

        logger.info(`DatabaseUpdater::updateScores - finished updating ${numScores} scores! Duration = ${durationHrs.toFixed(2)} hours.`);
        return;
    }

    /**
     * Update each user in database by re-retrieving from osu!API.
     * @returns {Promise<void>}
     */
    public async updateUsers (): Promise<void> {
        logger.info('DatabaseUpdater::updateUsers - updating all users in the database...');

        const startTimeMs = new Date(Date.now()).getTime();

        const dbUsers = await this._dbm.getUsers();

        const modsToScores: { [key: string]: MORScore[] } = {};
        for (const key in MORMod) {
            modsToScores[key] = await this._dbm.getTableScores(key);
            (modsToScores[key] as MORScore[]).sort((a, b) => b[MORScoreKey.PP] - a[MORScoreKey.PP]);
            modsToScores[key] = (modsToScores[key] as MORScore[]).slice(0, 3);
        }

        // Update user data - endpoint only supports 50 at a time so we chunk the requests
        for (let i = 0; i < dbUsers.length; i += 50) {
            const userIDChunk = dbUsers.map((x) => x[MORUserKey.USER_ID].toString()).slice(i, i + 50);
            logger.info(`DatabaseUpdater::updateUsers - updating users: ${userIDChunk}`);
            const response = await this._osu.getUsers(userIDChunk);
            const osuUserChunk = response.users;

            for (const osuUser of osuUserChunk) {
                const dbUser = dbUsers.find((x) => x[MORUserKey.USER_ID] === osuUser.id);
                if (!defined(dbUser)) {
                    logger.error(`DatabaseUpdater::updateUsers - could not find database user ${osuUser.id} in "${this._dbm.filename}" - skipping... This should never happen!`);
                    continue;
                }

                let top1s = 0;
                let top2s = 0;
                let top3s = 0;

                for (const key of Object.keys(modsToScores)) {
                    const scores = modsToScores[key] as MORScore[];
                    for (let i = 0; i < scores.length; ++i) {
                        const userID = (scores[i] as MORScore)[MORScoreKey.USER_ID];
                        if (userID !== osuUser.id) {
                            continue;
                        } else if (i === 0) {
                            ++top1s;
                        } else if (i === 1) {
                            ++top2s;
                        } else if (i === 2) {
                            ++top3s;
                        } else {
                            throw new RangeError(`DatabaseUpdater::updateUsers - i=${i}; this should never happen!`);
                        }
                    }
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
                    [MORUserKey.TOP_1S]: top1s,
                    [MORUserKey.TOP_2S]: top2s,
                    [MORUserKey.TOP_3S]: top3s,
                    [MORUserKey.AUTOTRACK]: (dbUser as MORUser)[MORUserKey.AUTOTRACK]
                };

                await this._dbm.updateUser(updatedUser);
            }
        }

        const endTimeMs = new Date(Date.now()).getTime();
        const durationMin = (endTimeMs - startTimeMs) / 60000;

        logger.info(`DatabaseUpdater::updateUsers - finished updating users! Duration = ${durationMin.toFixed(2)} minutes.`);
        return;
    }

    /**
     * Take MOR3 USERS sheet CSV file and input to database.
     * @param {PathOrFileDescriptor} path
     * @returns {Promise<void>}
     */
    public async portMOR3Users (path: PathOrFileDescriptor): Promise<void> {
        logger.info(`DatabaseUpdater::portMOR3Users - porting MOR3 users from ${path} to database...`);

        const startTimeMs = new Date(Date.now()).getTime();

        if (extname(path.toString()) !== '.csv') {
            throw new TypeError(`DatabaseUpdater::portMOR3Users - file must be a Google Sheets .csv file! path = ${path}`);
        }

        logger.info('DatabaseUpdater::portMOR3Users - reading data from file...');
        const data = readFileSync(path, 'utf-8');
        const lines = data.split('\n');
        lines.shift();

        const dbUsers = [];
        for (let line of lines) {
            // Playstyle string in CSV may contain commas; if so, it is surrounded by quotation marks.
            // Check for such strings and replace with dummy string. Playstyle is not stored in MOR4 database so we don't need to store it.
            const regex = /".*"/;
            const quoteStrings = line.match(regex);
            if (quoteStrings) {
                line = line.replace(regex, 'TEMP');
            }

            // Parse line
            const vals = line.split(',');
            const dbUser: MORUser = {
                [MORUserKey.USER_ID]: parseInt(vals[0] as string),
                [MORUserKey.USERNAME]: vals[1] as string,
                [MORUserKey.COUNTRY_CODE]: vals[3] as string,
                [MORUserKey.GLOBAL_RANK]: parseInt(vals[4] as string),
                [MORUserKey.PP]: parseFloat(vals[6] as string),
                [MORUserKey.ACCURACY]: parseFloat(vals[7] as string),
                [MORUserKey.PLAYTIME]: parseInt(vals[8] as string),
                [MORUserKey.PLAYCOUNT]: -1,
                [MORUserKey.RANKED_SCORE]: -1,
                [MORUserKey.MAX_COMBO]: -1,
                [MORUserKey.REPLAYS_WATCHED]: -1,
                [MORUserKey.PFP_IMAGE_URL]: vals[15] as string,
                [MORUserKey.TOP_1S]: parseInt(vals[9] as string),
                [MORUserKey.TOP_2S]: parseInt(vals[10] as string),
                [MORUserKey.TOP_3S]: parseInt(vals[11] as string),
                [MORUserKey.AUTOTRACK]: ((vals[16] === 'TRUE\r') || (vals[16] === 'TRUE'))
            };

            dbUsers.push(dbUser);
        }

        // Update user data - endpoint only supports 50 at a time so we chunk the requests
        for (let i = 0; i < dbUsers.length; i += 50) {
            const userIDChunk = dbUsers.map((x) => x[MORUserKey.USER_ID].toString()).slice(i, i + 50);
            const response = await this._osu.getUsers(userIDChunk);
            const osuUserChunk = response.users;

            for (const osuUser of osuUserChunk) {
                let dbUser = dbUsers.find((x) => x[MORUserKey.USER_ID] === osuUser.id);
                if (!defined(dbUser)) {
                    logger.warn(`DatabaseUpdater::portMOR3Users - could not find database user ${osuUser.id} - skipping... This should never happen!`);
                    continue;
                }
                dbUser = dbUser as MORUser;

                dbUser[MORUserKey.USER_ID] = osuUser.id;
                dbUser[MORUserKey.USERNAME] = osuUser.username;
                dbUser[MORUserKey.COUNTRY_CODE] = osuUser.country_code;
                dbUser[MORUserKey.GLOBAL_RANK] = osuUser.statistics_rulesets.osu.global_rank;
                dbUser[MORUserKey.PP] = osuUser.statistics_rulesets.osu.pp;
                dbUser[MORUserKey.ACCURACY] = osuUser.statistics_rulesets.osu.hit_accuracy;
                dbUser[MORUserKey.PLAYTIME] = osuUser.statistics_rulesets.osu.play_time;
                dbUser[MORUserKey.PLAYCOUNT] = osuUser.statistics_rulesets.osu.play_count;
                dbUser[MORUserKey.RANKED_SCORE] = osuUser.statistics_rulesets.osu.ranked_score;
                dbUser[MORUserKey.MAX_COMBO] = osuUser.statistics_rulesets.osu.maximum_combo;
                dbUser[MORUserKey.REPLAYS_WATCHED] = osuUser.statistics_rulesets.osu.replays_watched_by_others;
                dbUser[MORUserKey.PFP_IMAGE_URL] = osuUser.avatar_url;

                logger.info(`DatabaseUpdater::portMOR3Users - inserting ${osuUser.id} into the database...`);
                await this._dbm.insertUser(dbUser);
            }
        }

        const endTimeMs = new Date(Date.now()).getTime();
        const durationMin = (endTimeMs - startTimeMs) / 60000;

        logger.info(`DatabaseUpdater::portMOR3Users - finished porting users! Duration = ${durationMin.toFixed(2)} minutes.`);
        return;
    }

    /**
     * Take MOR3 COMBINED sheet CSV file and input to database.
     * @param {PathOrFileDescriptor} path
     * @returns {Promise<void>}
     */
    public async portMOR3Scores (path: PathOrFileDescriptor): Promise<void> {
        logger.info(`DatabaseUpdater::portMOR3Scores - porting MOR3 scores from ${path} to database...`);

        const startTimeMs = new Date(Date.now()).getTime();

        if (extname(path.toString()) !== '.csv') {
            throw new TypeError(`DatabaseUpdater::portMOR3Scores - file must be a Google Sheets .csv file! path = ${path}`);
        }

        logger.info('DatabaseUpdater::portMOR3Scores - reading data from file...');
        const data = readFileSync(path, 'utf-8');
        const lines = data.split('\n');
        lines.shift();

        const numMOR3Scores = lines.length;
        let numComplete = 0;
        for (let line of lines) {
            // Beatmap string in CSV may contain commas; if so, it is surrounded by quotation marks.
            // If such a string exists, store it and replace with dummy string, then strip outer quotation marks from stored string.
            // E.g. "AliA - Kakurenbo [Ready, Set, Go!]" ===> AliA - Kakurenbo [Ready, Set, Go!]
            // String will also be surrounded by quotation marks if there are inner quotation marks. Inner quotation marks are denoted with two quotation marks.
            // E.g."BEMANI Sound Team ""Expander"" - Neuron [Crack]" ===> BEMANI Sound Team "Expander" - Neuron [Crack]
            const regex = /".*"/;
            const quoteStrings = line.match(regex);
            let beatmap = undefined;
            if (quoteStrings) {
                line = line.replace(regex, 'TEMP');
                beatmap = quoteStrings[0];
                beatmap = beatmap.slice(1, -1);
                beatmap = beatmap.replaceAll('""', '"');
            }

            // Parse line
            const vals = line.split(',');
            const dbScore: MORScore = {
                [MORScoreKey.SCORE_ID]: parseInt(vals[0] as string),
                [MORScoreKey.USER_ID]: parseInt(vals[1] as string),
                [MORScoreKey.BEATMAP_ID]: 0,
                [MORScoreKey.USERNAME]: vals[2] as string,
                [MORScoreKey.BEATMAP]: defined(beatmap) ? beatmap as string : vals[3] as string,
                [MORScoreKey.MODS]: vals[4] as string,
                [MORScoreKey.ACCURACY]: parseFloat(vals[5] as string),
                [MORScoreKey.PP]: parseFloat(vals[6] as string),
                [MORScoreKey.STAR_RATING]: parseFloat(vals[7] as string),
                [MORScoreKey.DATE]: vals[8] as string,
                [MORScoreKey.BEATMAP_IMAGE_URL]: (vals[9] as string).replaceAll('\r', '')
            };

            logger.info(`DatabaseUpdater::portMOR3Scores - inserting score ${dbScore[MORScoreKey.SCORE_ID]} into database... (${numComplete}/${numMOR3Scores})`);
            await this._dbm.insertScore(dbScore);
            ++numComplete;
        }

        const endTimeMs = new Date(Date.now()).getTime();
        const durationMin = (endTimeMs - startTimeMs) / 60000;

        logger.info(`DatabaseUpdater::portMOR3Scores - finished porting scores! Duration = ${durationMin.toFixed(2)} minutes.`);
        return;
    }

    /* ------------------------------------------------------------------------------------------------------------------------------------ */
    /* ---------------------------------------------------------------PRIVATE-------------------------------------------------------------- */
    /* ------------------------------------------------------------------------------------------------------------------------------------ */

    /**
     * Construct updater.
     * Not meant to be called directly - use DatabaseUpdater.build() instead!
     * @param {string} filename
     * @param {OsuWrapper} osu
     */
    private constructor (filename: string, osu: OsuWrapper) {
        logger.debug(`DatabaseUpdater::constructor - constructing DatabaseUpdater instance for "${filename}"...`);

        this._dbm = new DatabaseManager(filename);
        this._osu = osu;
    }
}
