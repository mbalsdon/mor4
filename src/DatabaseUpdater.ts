import { MORDatabaseSpecialKey, MORMod, MORUserKey, MORScoreKey, OsuScoreType, MORScore, getMORBeatmapString, affectsStarRating, stringToOsuMod, convertOsuMods, modStringToArray, getRowCount, defined, MORUser } from './util/Common.js';
import OsuWrapper from './OsuWrapper.js';
import MORConfig from './util/MORConfig.js';

import sqlite3 from 'sqlite3';

import { readFileSync, PathOrFileDescriptor } from 'fs';
import { extname } from 'path';

import './util/Logger.js';
import { loggers } from 'winston';
const logger = loggers.get('logger');

/**
 * Updates local database with osu! data.
 */
export default class DatabaseUpdater {
    private _database: sqlite3.Database;
    private _osu: OsuWrapper;

    /* ------------------------------------------------------------------ */
    /* ------------------------------PUBLIC------------------------------ */
    /* ------------------------------------------------------------------ */

    /**
     * Construct DatabaseUpdater.
     * @returns {Promise<DatabaseUpdater>}
     */
    public static async build (): Promise<DatabaseUpdater> {
        logger.info('DatabaseUpdater::build - building DatabaseUpdater...');

        const osu = await OsuWrapper.build();
        return new DatabaseUpdater(osu);
    }

    /**
     * Take top/recent/first/pinned scores of each tracked user and insert them into database.
     * @returns {Promise<void>}
     */
    public async getNewScores (): Promise<void> {
        logger.info('DatabaseUpdater::getNewScores - collecting plays from tracked users and inserting into database... This may take a while!');
        const startTimeMs = new Date(Date.now()).getTime();
        const startNumScores = await this.getNumScores();

        const userIDs = await this.getAutotrackUserIDs();
        for (const userID of userIDs) {
            logger.info(`DatabaseUpdater::getNewScores - retrieving scores for user ${userID}...`);
            const userIDString = userID.toString();
            const userTops = await this._osu.getUserScores(userIDString, OsuScoreType.BEST);
            const userFirsts = await this._osu.getUserScores(userIDString, OsuScoreType.FIRSTS);
            const userRecents = await this._osu.getUserScores(userIDString, OsuScoreType.RECENT);
            const userPinned = await this._osu.getUserScores(userIDString, OsuScoreType.PINNED);

            logger.debug('DatabaseUpdater::getNewScores - converting scores to database format...');
            const morScores: MORScore[] = [];
            for (const userScore of [ ...userTops, ...userFirsts, ...userRecents, ...userPinned ]) {
                // Skip duplicates
                if (morScores.some((morScore: MORScore) => morScore[MORScoreKey.SCORE_ID] === userScore.id)) {
                    continue;
                }

                // Score response only includes base SR - need extra work to determine SR with mods applied
                const morScore = await this.osuScoreToMORScore(userScore);
                morScores.push(morScore);
            }

            logger.info(`DatabaseUpdater::getNewScores - inserting scores from user ${userID} into database...`);
            for (const score of morScores) {
                await this.insertScore(score);
            }
        }

        const endNumScores = await this.getNumScores();
        const numInserted = endNumScores - startNumScores;
        const endTimeMs = new Date(Date.now()).getTime();
        const durationMin = (endTimeMs - startTimeMs) / 60000;
        logger.info(`DatabaseUpdater::getNewScores - successfully updated database with new scores! Inserted ${numInserted} plays. Duration = ${durationMin.toFixed(2)} minutes.`);
        return;
    }

    /**
     * Remove duplicate scores from database; instances are observed where score is submitted twice (but with different score IDs)
     * @returns {Promise<void>}
     */
    public async removeDuplicateScores (): Promise<void> {
        logger.info('DatabaseUpdater::removeDuplicateScores - removing duplicate scores... This may take a while!');
        const startTimeMs = new Date(Date.now()).getTime();
        let numRemoved = 0;

        for (const key in MORMod) {
            const scoreIDs = await this.getDuplicateScoreIDs(key);
            for (const scoreID of scoreIDs) {
                // NOTE: If both instances of duplicate score can't be found, both are removed. This can happen if a player
                //       overwrites the duplicated score with a better score (osu!API only stores the best play). This is
                //       okay though since we want to remove overwritten scores anyways.
                const score = await this._osu.getScore(scoreID.toString(), 2, 1);
                if (!defined(score)) {
                    logger.info(`DatabaseUpdater::removeDuplicateScores - osu!API could not find ${key} score ${scoreID}; removing...`);
                    await this.removeScore(scoreID, key);
                    ++numRemoved;
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
     * @returns {Promise<void>}
     */
    public async updateScores (): Promise<void> {
        logger.info('DatabaseUpdater::updateScores - updating all scores in the database... This will take a really long time!');
        const startTimeMs = new Date(Date.now()).getTime();

        const numScores = await this.getNumScores();
        // 100ms is a rough adjustment, based only on my machine
        const cooldownHrs = (MORConfig.OSU_API_COOLDOWN_MS + 100) / 3600000;
        let estimatedHrsRemaining = numScores * cooldownHrs;
        let numCompleted = 0;

        for (const key in MORMod) {
            logger.info(`DatabaseUpdater::updateScores - updating ${key} scores...`);
            const scores = await this.getScores(key);

            for (const score of scores) {
                const scoreID = score[MORScoreKey.SCORE_ID];
                logger.info(`DatabaseUpdater::updateScores - updating score ${scoreID}... (${numCompleted}/${numScores}, estimated time remaining = ${estimatedHrsRemaining.toFixed(2)} hours)`);

                const updatedScore = await this._osu.getScore(scoreID.toString(), 2, 1);
                if (!defined(updatedScore)) {
                    logger.info(`DatabaseUpdater::updateScores - osu!API could not find ${key} score ${scoreID}; removing...`);
                    await this.removeScore(scoreID, key);
                    continue;
                }

                const dbScore = await this.osuScoreToMORScore(updatedScore);
                await this.updateScore(dbScore);

                estimatedHrsRemaining -= cooldownHrs;
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

        const dbUsers = await this.getUsers();

        // Update user data - endpoint only supports 50 at a time so we chunk the requests
        for (let i = 0; i < dbUsers.length; i += 50) {
            const userIDChunk = dbUsers.map((x) => x[MORUserKey.USER_ID].toString()).slice(i, i + 50);
            const response = await this._osu.getUsers(userIDChunk);
            const osuUserChunk = response.users;

            for (const osuUser of osuUserChunk) {
                const dbUser = dbUsers.find((x) => x[MORUserKey.USER_ID] === osuUser.id);
                if (!defined(dbUser)) {
                    logger.warn(`DatabaseUpdater::updateUsers - could not find database user ${osuUser.id} - skipping... This should never happen!`);
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
                    [MORUserKey.TOP_1S]: (dbUser as MORUser)[MORUserKey.TOP_1S],
                    [MORUserKey.TOP_2S]: (dbUser as MORUser)[MORUserKey.TOP_2S],
                    [MORUserKey.TOP_3S]: (dbUser as MORUser)[MORUserKey.TOP_3S],
                    [MORUserKey.PFP_IMAGE_URL]: osuUser.avatar_url,
                    [MORUserKey.AUTOTRACK]: (dbUser as MORUser)[MORUserKey.AUTOTRACK]
                };

                logger.info(`DatabaseUpdater::updateUsers - updating user ${osuUser.id}...`);
                await this.updateUser(updatedUser);
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
                [MORUserKey.TOP_1S]: parseInt(vals[9] as string),
                [MORUserKey.TOP_2S]: parseInt(vals[10] as string),
                [MORUserKey.TOP_3S]: parseInt(vals[11] as string),
                [MORUserKey.PFP_IMAGE_URL]: vals[15] as string,
                [MORUserKey.AUTOTRACK]: (vals[16] === 'TRUE')
            };

            dbUsers.push(dbUser);
        }

        // Update user data - endpoint only supports 50 at a time so we chunk the requests
        for (let i = 0; i < dbUsers.length; i += 50) {
            const userIDChunk = dbUsers.map((x) => x[MORUserKey.USER_ID].toString()).slice(i, i + 50);
            const response = await this._osu.getUsers(userIDChunk);
            const osuUserChunk = response.users;

            for (const osuUser of osuUserChunk) {
                const dbUser = dbUsers.find((x) => x[MORUserKey.USER_ID] === osuUser.id);
                if (!defined(dbUser)) {
                    logger.warn(`DatabaseUpdater::portMOR3Users - could not find database user ${osuUser.id} - skipping... This should never happen!`);
                    continue;
                }

                (dbUser as MORUser)[MORUserKey.USER_ID] = osuUser.id;
                (dbUser as MORUser)[MORUserKey.USERNAME] = osuUser.username;
                (dbUser as MORUser)[MORUserKey.COUNTRY_CODE] = osuUser.country_code;
                (dbUser as MORUser)[MORUserKey.GLOBAL_RANK] = osuUser.statistics_rulesets.osu.global_rank;
                (dbUser as MORUser)[MORUserKey.PP] = osuUser.statistics_rulesets.osu.pp;
                (dbUser as MORUser)[MORUserKey.ACCURACY] = osuUser.statistics_rulesets.osu.hit_accuracy;
                (dbUser as MORUser)[MORUserKey.PLAYTIME] = osuUser.statistics_rulesets.osu.play_time;
                (dbUser as MORUser)[MORUserKey.PFP_IMAGE_URL] = osuUser.avatar_url;

                logger.info(`DatabaseUpdater::portMOR3Users - inserting ${osuUser.id} into the database...`);
                await this.insertUser(dbUser as MORUser);
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

        logger.info('DatabaseUpdater::portMOR3Scores - inserting scores into database...');
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
                [MORScoreKey.USERNAME]: vals[2] as string,
                [MORScoreKey.BEATMAP]: defined(beatmap) ? beatmap as string : vals[3] as string,
                [MORScoreKey.MODS]: vals[4] as string,
                [MORScoreKey.ACCURACY]: parseFloat(vals[5] as string),
                [MORScoreKey.PP]: parseFloat(vals[6] as string),
                [MORScoreKey.STAR_RATING]: parseFloat(vals[7] as string),
                [MORScoreKey.DATE]: vals[8] as string,
                [MORScoreKey.BEATMAP_IMAGE_URL]: vals[9] as string
            };

            logger.info(`DatabaseUpdater::portMOR3Scores - inserting score ${dbScore[MORScoreKey.SCORE_ID]} into database... (${numComplete}/${numMOR3Scores})`);
            await this.insertScore(dbScore);
            ++numComplete;
        }

        const endTimeMs = new Date(Date.now()).getTime();
        const durationMin = (endTimeMs - startTimeMs) / 60000;
        logger.info(`DatabaseUpdater::portMOR3Scores - finished porting scores! Duration = ${durationMin.toFixed(2)} minutes.`);
        return;
    }

    /* ------------------------------------------------------------------ */
    /* ------------------------------PRIVATE----------------------------- */
    /* ------------------------------------------------------------------ */

    /**
     * Constructs the updater.
     * Not meant to be called directly - use DatabaseUpdater.build() instead!
     * @param {OsuWrapper} osu
     */
    private constructor (osu: OsuWrapper) {
        const database = new sqlite3.Database(MORConfig.DB_FILEPATH);
        database.exec(`CREATE TABLE IF NOT EXISTS ${MORDatabaseSpecialKey.USERS} (
            ${MORUserKey.USER_ID} UNSIGNED BIG INT NOT NULL PRIMARY KEY,
            ${MORUserKey.USERNAME} TEXT,
            ${MORUserKey.COUNTRY_CODE} TEXT(2),
            ${MORUserKey.GLOBAL_RANK} UNSIGNED BIG INT,
            ${MORUserKey.PP} REAL,
            ${MORUserKey.ACCURACY} REAL,
            ${MORUserKey.PLAYTIME} UNSIGNED BIG INT,
            ${MORUserKey.TOP_1S} TINYINT,
            ${MORUserKey.TOP_2S} TINYINT,
            ${MORUserKey.TOP_3S} TINYINT,
            ${MORUserKey.PFP_IMAGE_URL} TEXT,
            ${MORUserKey.AUTOTRACK} BOOLEAN,
            CHECK (${MORUserKey.PP} >= 0),
            CHECK (${MORUserKey.ACCURACY} >= 0),
            CHECK (${MORUserKey.TOP_1S} >= 0 AND ${MORUserKey.TOP_1S} <= ${Object.keys(MORMod).length}),
            CHECK (${MORUserKey.TOP_2S} >= 0 AND ${MORUserKey.TOP_2S} <= ${Object.keys(MORMod).length}),
            CHECK (${MORUserKey.TOP_3S} >= 0 AND ${MORUserKey.TOP_3S} <= ${Object.keys(MORMod).length})
        )`);
        for (const key in MORMod) {
            database.exec(`CREATE TABLE IF NOT EXISTS ${key} (
                ${MORScoreKey.SCORE_ID} UNSIGNED BIG INT NOT NULL PRIMARY KEY,
                ${MORScoreKey.USER_ID} UNSIGNED BIG INT NOT NULL,
                ${MORScoreKey.USERNAME} TEXT,
                ${MORScoreKey.BEATMAP} TEXT,
                ${MORScoreKey.MODS} TEXT(12),
                ${MORScoreKey.PP} REAL,
                ${MORScoreKey.ACCURACY} REAL,
                ${MORScoreKey.STAR_RATING} REAL,
                ${MORScoreKey.DATE} DATETIME,
                ${MORScoreKey.BEATMAP_IMAGE_URL} TEXT,
                CHECK (${MORScoreKey.PP} >= 0),
                CHECK (${MORScoreKey.ACCURACY} >= 0),
                CHECK (${MORScoreKey.STAR_RATING} >= 0)
            )`);
        }

        this._database = database;
        this._osu = osu;
    }

    /**
     * Get userIDs of users with autotrack enabled.
     * @returns {Promise<number[]>}
     */
    private getAutotrackUserIDs (): Promise<number[]> {
        logger.debug('DatabaseUpdater::getAutotrackUserIDs - retrieving userIDs of tracked database users...');

        return new Promise((resolve, reject) => {
            const sql = `SELECT ${MORUserKey.USER_ID} FROM ${MORDatabaseSpecialKey.USERS} WHERE ${MORUserKey.AUTOTRACK} = 1`;
            this._database.all(sql, (err, rows: MORUser[]) => {
                if (err) {
                    logger.error(`DatabaseUpdater::getAutotrackUserIDs - failed to retrieve; ${err.message}`);
                    reject(err);
                }
                const userIDs: number[] = rows.map((row) => row[MORUserKey.USER_ID]);
                resolve(userIDs);
            });
        });
    }

    /**
     * Insert score into database.
     * @param {MORScore} score
     * @returns {Promise<void>}
     */
    private insertScore (score: MORScore): Promise<void> {
        logger.debug(`DatabaseUpdater::insertScore - inserting score ${score[MORScoreKey.SCORE_ID]} into database...`);

        return new Promise((resolve, reject) => {
            const sql = `INSERT INTO ${convertOsuMods(modStringToArray(score[MORScoreKey.MODS]))} (
                ${MORScoreKey.SCORE_ID},
                ${MORScoreKey.USER_ID},
                ${MORScoreKey.USERNAME},
                ${MORScoreKey.BEATMAP},
                ${MORScoreKey.MODS},
                ${MORScoreKey.PP},
                ${MORScoreKey.ACCURACY},
                ${MORScoreKey.STAR_RATING},
                ${MORScoreKey.DATE},
                ${MORScoreKey.BEATMAP_IMAGE_URL}
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
            const params = [
                score[MORScoreKey.SCORE_ID],
                score[MORScoreKey.USER_ID],
                score[MORScoreKey.USERNAME],
                score[MORScoreKey.BEATMAP],
                score[MORScoreKey.MODS],
                score[MORScoreKey.PP],
                score[MORScoreKey.ACCURACY],
                score[MORScoreKey.STAR_RATING],
                score[MORScoreKey.DATE],
                score[MORScoreKey.BEATMAP_IMAGE_URL]
            ];
            this._database.run(sql, params, (err) => {
                if (err) {
                    if (err.message.includes('UNIQUE')) {
                        logger.debug(`DatabaseUpdater::insertScore - skipping score ${score[MORScoreKey.SCORE_ID]}; already exists in database...`);
                        resolve();
                    } else {
                        logger.error(`DatabaseUpdater::insertScore - failed to insert score ${score[MORScoreKey.SCORE_ID]}; ${err.message}`);
                        reject(err);
                    }
                }
                resolve();
            });
        });
    }

    /**
     * Return total number of score in database.
     * @returns {number}
     */
    private async getNumScores (): Promise<number> {
        logger.debug('DatabaseUpdater::getNumScores - retrieving number of scores in database...');

        let numScores = 0;
        for (const key in MORMod) {
            numScores += await getRowCount(this._database, key);
        }
        return numScores;
    }

    /**
     * Return array of scoreIDs of duplicate scores.
     * @param {string} tableName
     * @returns {Promise<number[]>}
     */
    private async getDuplicateScoreIDs (tableName: string): Promise<number[]> {
        logger.debug(`DatabaseUpdater::getDuplicateScoreIDs - searching ${tableName} for duplicate scores...`);

        return new Promise((resolve, reject) => {
            const sql = `SELECT t1.*
                    FROM ${tableName} t1
                    JOIN ${tableName} t2 ON
                    t1.${MORScoreKey.USER_ID} = t2.${MORScoreKey.USER_ID} AND
                    t1.${MORScoreKey.USERNAME} = t2.${MORScoreKey.USERNAME} AND
                    t1.${MORScoreKey.BEATMAP} = t2.${MORScoreKey.BEATMAP} AND
                    t1.${MORScoreKey.MODS} = t2.${MORScoreKey.MODS} AND
                    t1.${MORScoreKey.PP} = t2.${MORScoreKey.PP} AND
                    t1.${MORScoreKey.ACCURACY} = t2.${MORScoreKey.ACCURACY} AND
                    t1.${MORScoreKey.STAR_RATING} = t2.${MORScoreKey.STAR_RATING} AND
                    t1.${MORScoreKey.DATE} = t2.${MORScoreKey.DATE} AND
                    t1.${MORScoreKey.BEATMAP_IMAGE_URL} = t2.${MORScoreKey.BEATMAP_IMAGE_URL}
                    WHERE t1.${MORScoreKey.SCORE_ID} <> t2.${MORScoreKey.SCORE_ID};`;
            this._database.all(sql, (err, rows: MORScore[]) => {
                if (err) {
                    logger.error(`DatabaseUpdater::getDuplicateScoreIDs - failed to retrieve; ${err.message}`);
                    reject(err);
                }
                const scoreIDs = rows.map((row) => row[MORScoreKey.SCORE_ID]);
                resolve(scoreIDs);
            });
        });
    }

    /**
     * Remove score.
     * @param {number} scoreID
     * @param {string} tableName
     * @returns {Promise<void>}
     */
    private async removeScore (scoreID: number, tableName: string): Promise<void> {
        logger.debug(`DatabaseUpdater::removeScore - removing score ${scoreID} from ${tableName}...`);

        return new Promise((resolve, reject) => {
            const sql = `DELETE FROM ${tableName} WHERE ${MORScoreKey.SCORE_ID} = ?`;
            const params = [ scoreID ];
            this._database.run(sql, params, (err) => {
                if (err) {
                    logger.error(`DatabaseUpdater::removeScore - failed to remove score ${scoreID} from ${tableName}; ${err.message}`);
                    reject(err);
                }
                resolve();
            });
        });
    }

    /**
     * Return all scores from table.
     * @param {string} tableName
     * @returns {Promise<MORScore[]>}
     */
    private async getScores (tableName: string): Promise<MORScore[]> {
        logger.debug(`DatabaseUpdater::getScores - retrieving scores from ${tableName}...`);

        return new Promise((resolve, reject) => {
            const sql = `SELECT * FROM ${tableName}`;
            this._database.all(sql, (err, rows: MORScore[]) => {
                if (err) {
                    logger.error(`DatabaseUpdater::getScores - failed to retrieve; ${err.message}`);
                    reject(err);
                }
                resolve(rows);
            });
        });
    }

    /**
     * Convert osu!API score to MORScore.
     * @param {any} osuScore [Score](https://osu.ppy.sh/docs/index.html#score)
     * @returns {Promise<MORScore>}
     */
    private async osuScoreToMORScore (osuScore: any): Promise<MORScore> {
        const mods: string[] = osuScore.mods;
        let starRating = osuScore.beatmap.difficulty_rating;
        if (affectsStarRating(mods)) {
            const difficultyAttributes = await this._osu.getBeatmapAttributes(osuScore.beatmap.id, mods.map((x: string) => stringToOsuMod(x)));
            starRating = difficultyAttributes.attributes.star_rating;
        }

        const morScore: MORScore = {
            [MORScoreKey.SCORE_ID]: osuScore.best_id,
            [MORScoreKey.USER_ID]: osuScore.user.id,
            [MORScoreKey.USERNAME]: osuScore.user.username,
            [MORScoreKey.BEATMAP]: getMORBeatmapString(osuScore),
            [MORScoreKey.MODS]: mods.join().replaceAll(',', ''),
            [MORScoreKey.PP]: osuScore.pp,
            [MORScoreKey.ACCURACY]: osuScore.accuracy,
            [MORScoreKey.STAR_RATING]: starRating,
            [MORScoreKey.DATE]: osuScore.created_at,
            [MORScoreKey.BEATMAP_IMAGE_URL]: osuScore.beatmapset.covers['list@2x']
        };
        return morScore;
    }

    /**
     * Update database score.
     * @param {MORScore} score
     * @returns {Promise<void>}
     */
    private async updateScore (score: MORScore): Promise<void> {
        logger.debug(`DatabaseUpdater::updateScore - updating database score ${score[MORScoreKey.SCORE_ID]}...`);

        return new Promise((resolve, reject) => {
            const sql = `UPDATE ${convertOsuMods(modStringToArray(score[MORScoreKey.MODS]))} SET
                ${MORScoreKey.USER_ID} = ?,
                ${MORScoreKey.USERNAME} = ?,
                ${MORScoreKey.BEATMAP} = ?,
                ${MORScoreKey.MODS} = ?,
                ${MORScoreKey.PP} = ?,
                ${MORScoreKey.ACCURACY} = ?,
                ${MORScoreKey.STAR_RATING} = ?,
                ${MORScoreKey.DATE} = ?,
                ${MORScoreKey.BEATMAP_IMAGE_URL} = ?
                WHERE ${MORScoreKey.SCORE_ID} = ?;`;
            const data = [
                score[MORScoreKey.USER_ID],
                score[MORScoreKey.USERNAME],
                score[MORScoreKey.BEATMAP],
                score[MORScoreKey.MODS],
                score[MORScoreKey.PP],
                score[MORScoreKey.ACCURACY],
                score[MORScoreKey.STAR_RATING],
                score[MORScoreKey.DATE],
                score[MORScoreKey.BEATMAP_IMAGE_URL],
                score[MORScoreKey.SCORE_ID]
            ];
            const scoreID = score[MORScoreKey.SCORE_ID];
            this._database.run(sql, data, (err) => {
                if (err) {
                    logger.debug(`DatabaseUpdater::updateScore - failed to update score ${scoreID}; ${err.message}`);
                    reject(err);
                }
                resolve();
            });
        });
    }

    private async getUsers (): Promise<MORUser[]> {
        logger.debug(`DatabaseUpdater::getUsers - retrieving users from ${MORDatabaseSpecialKey.USERS}...`);

        return new Promise((resolve, reject) => {
            const sql = `SELECT * FROM ${MORDatabaseSpecialKey.USERS}`;
            this._database.all(sql, (err, rows: MORUser[]) => {
                if (err) {
                    logger.error(`DatabaseUpdater::getUsers - failed to retrieve; ${err.message}`);
                    reject(err);
                }
                resolve(rows);
            });
        });
    }

    private async updateUser (user: MORUser): Promise<void> {
        logger.debug(`DatabaseUpdater::updateUser - updating database user ${user[MORUserKey.USER_ID]}...`);

        return new Promise((resolve, reject) => {
            const sql = `UPDATE ${MORDatabaseSpecialKey.USERS} SET
                ${MORUserKey.USERNAME} = ?,
                ${MORUserKey.COUNTRY_CODE} = ?,
                ${MORUserKey.GLOBAL_RANK} = ?,
                ${MORUserKey.PP} = ?,
                ${MORUserKey.ACCURACY} = ?,
                ${MORUserKey.PLAYTIME} = ?,
                ${MORUserKey.TOP_1S} = ?,
                ${MORUserKey.TOP_2S} = ?,
                ${MORUserKey.TOP_3S} = ?,
                ${MORUserKey.PFP_IMAGE_URL} = ?,
                ${MORUserKey.AUTOTRACK} = ?
                WHERE ${MORUserKey.USER_ID} = ?;`;
            const data = [
                user[MORUserKey.USERNAME],
                user[MORUserKey.COUNTRY_CODE],
                user[MORUserKey.GLOBAL_RANK],
                user[MORUserKey.PP],
                user[MORUserKey.ACCURACY],
                user[MORUserKey.PLAYTIME],
                user[MORUserKey.TOP_1S],
                user[MORUserKey.TOP_2S],
                user[MORUserKey.TOP_3S],
                user[MORUserKey.PFP_IMAGE_URL],
                user[MORUserKey.AUTOTRACK],
                user[MORUserKey.USER_ID]
            ];
            const userID = user[MORUserKey.USER_ID];
            this._database.run(sql, data, (err) => {
                if (err) {
                    logger.debug(`DatabaseUpdater::updateUser - failed to update user ${userID}; ${err.message}`);
                    reject(err);
                }
                resolve();
            });
        });
    }

    private async insertUser (user: MORUser): Promise<void> {
        logger.debug(`DatabaseUpdater::insertUser - inserting user ${user[MORUserKey.USER_ID]} into database...`);

        return new Promise((resolve, reject) => {
            const sql = `INSERT INTO ${MORDatabaseSpecialKey.USERS} (
                ${MORUserKey.USER_ID},
                ${MORUserKey.USERNAME},
                ${MORUserKey.COUNTRY_CODE},
                ${MORUserKey.GLOBAL_RANK},
                ${MORUserKey.PP},
                ${MORUserKey.ACCURACY},
                ${MORUserKey.PLAYTIME},
                ${MORUserKey.TOP_1S},
                ${MORUserKey.TOP_2S},
                ${MORUserKey.TOP_3S},
                ${MORUserKey.PFP_IMAGE_URL},
                ${MORUserKey.AUTOTRACK}
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
            const params = [
                user[MORUserKey.USER_ID],
                user[MORUserKey.USERNAME],
                user[MORUserKey.COUNTRY_CODE],
                user[MORUserKey.GLOBAL_RANK],
                user[MORUserKey.PP],
                user[MORUserKey.ACCURACY],
                user[MORUserKey.PLAYTIME],
                user[MORUserKey.TOP_1S],
                user[MORUserKey.TOP_2S],
                user[MORUserKey.TOP_3S],
                user[MORUserKey.PFP_IMAGE_URL],
                user[MORUserKey.AUTOTRACK]
            ];
            this._database.run(sql, params, (err) => {
                if (err) {
                    if (err.message.includes('UNIQUE')) {
                        logger.debug(`DatabaseUpdater::insertUser - skipping user ${user[MORUserKey.USER_ID]}; already exists in database...`);
                        resolve();
                    } else {
                        logger.error(`DatabaseUpdater::insertUser - failed to insert user ${user[MORUserKey.USER_ID]}; ${err.message}`);
                        reject(err);
                    }
                }
                resolve();
            });
        });
    }
}
