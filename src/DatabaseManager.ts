import { MORDatabaseSpecialKey, MORMod, MORScore, MORScoreKey, MORUser, MORUserKey, convertOsuMods, modStringToArray } from './util/Common.js';

import sqlite3 from 'sqlite3';

import './util/Logger.js';
import { loggers } from 'winston';
const logger = loggers.get('logger');

/**
 * Handles database operations.
 */
export default class DatabaseManager {
    private _database: sqlite3.Database;
    private _filename: string;

    /* ------------------------------------------------------------------------------------------------------------------------------------ */
    /* ---------------------------------------------------------------PUBLIC--------------------------------------------------------------- */
    /* ------------------------------------------------------------------------------------------------------------------------------------ */

    /**
     * Constructs the manager for given database file.
     * @param {string} filename
     */
    public constructor (filename: string) {
        logger.debug(`DatabaseManager::constructor - constructing DatabaseManager instance for "${filename}"...`);

        const database = new sqlite3.Database(filename);
        database.exec(`CREATE TABLE IF NOT EXISTS ${MORDatabaseSpecialKey.USERS} (
            ${MORUserKey.USER_ID} UNSIGNED BIG INT NOT NULL PRIMARY KEY,
            ${MORUserKey.USERNAME} TEXT,
            ${MORUserKey.COUNTRY_CODE} TEXT(2),
            ${MORUserKey.GLOBAL_RANK} UNSIGNED BIG INT,
            ${MORUserKey.PP} REAL,
            ${MORUserKey.ACCURACY} REAL,
            ${MORUserKey.PLAYTIME} UNSIGNED BIG INT,
            ${MORUserKey.PLAYCOUNT} UNSIGNED BIG INT,
            ${MORUserKey.RANKED_SCORE} UNSIGNED BIG INT,
            ${MORUserKey.MAX_COMBO} UNSIGNED BIG INT,
            ${MORUserKey.REPLAYS_WATCHED} UNSIGNED BIG INT,
            ${MORUserKey.PFP_IMAGE_URL} TEXT,
            ${MORUserKey.TOP_1S} TINYINT,
            ${MORUserKey.TOP_2S} TINYINT,
            ${MORUserKey.TOP_3S} TINYINT,
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
                ${MORScoreKey.BEATMAP_ID} UNSIGNED BIG INT NOT NULL,
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
        this._filename = filename;
    }

    /**
     * Return jobs.
     * @returns {MORJob[]}
     */
    public get filename (): string {
        return this._filename;
    }

    /**
     * Get userIDs of users with autotrack enabled.
     * @returns {Promise<MORUser[MORUserKey.USER_ID][]>}
     */
    public getAutotrackUserIDs (): Promise<MORUser[MORUserKey.USER_ID][]> {
        logger.debug(`DatabaseManager::getAutotrackUserIDs - retrieving userIDs of tracked users in "${this._filename}"...`);

        return new Promise((resolve, reject) => {
            const sql = `SELECT ${MORUserKey.USER_ID} FROM ${MORDatabaseSpecialKey.USERS} WHERE ${MORUserKey.AUTOTRACK} = 1`;
            this._database.all(sql, (err, rows: MORUser[]) => {
                if (err) {
                    logger.error(`DatabaseManager::getAutotrackUserIDs - failed to retrieve from "${this._filename}"! (${err.name}: ${err.message})`);
                    reject(err);
                }
                const userIDs = rows.map((row) => row[MORUserKey.USER_ID]);
                resolve(userIDs);
            });
        });
    }

    /**
     * Insert score into database.
     * @param {MORScore} score
     * @returns {Promise<void>}
     */
    public insertScore (score: MORScore): Promise<void> {
        logger.debug(`DatabaseManager::insertScore - inserting score ${score[MORScoreKey.SCORE_ID]} into "${this._filename}"...`);

        return new Promise((resolve, reject) => {
            const sql = `INSERT INTO ${convertOsuMods(modStringToArray(score[MORScoreKey.MODS]))} (
                ${MORScoreKey.SCORE_ID},
                ${MORScoreKey.USER_ID},
                ${MORScoreKey.BEATMAP_ID},
                ${MORScoreKey.USERNAME},
                ${MORScoreKey.BEATMAP},
                ${MORScoreKey.MODS},
                ${MORScoreKey.PP},
                ${MORScoreKey.ACCURACY},
                ${MORScoreKey.STAR_RATING},
                ${MORScoreKey.DATE},
                ${MORScoreKey.BEATMAP_IMAGE_URL}
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
            const params = [
                score[MORScoreKey.SCORE_ID],
                score[MORScoreKey.USER_ID],
                score[MORScoreKey.BEATMAP_ID],
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
                        logger.debug(`DatabaseManager::insertScore - skipping score ${score[MORScoreKey.SCORE_ID]}; already exists in "${this._filename}"...`);
                        resolve();
                    } else {
                        logger.error(`DatabaseManager::insertScore - failed to insert score ${score[MORScoreKey.SCORE_ID]} into "${this._filename}"! (${err.name}: ${err.message})`);
                        reject(err);
                    }
                }
                resolve();
            });
        });
    }

    /**
     * Return total number of scores in database.
     * @returns {Promise<number>}
     */
    public async getNumScores (): Promise<number> {
        logger.debug(`DatabaseManager::getNumScores - retrieving number of scores in "${this._filename}"...`);

        let numScores = 0;
        for (const key in MORMod) {
            numScores += await this.getRowCount(key);
        }
        return numScores;
    }

    /**
     * Returns total number of users in database.
     * @returns {Promise<number>}
     */
    public async getNumUsers (): Promise<number> {
        logger.debug(`DatabaseManager::getNumUsers - retrieving number of users in "${this._filename}"...`);

        const numUsers = await this.getRowCount(MORDatabaseSpecialKey.USERS);
        return numUsers;
    }

    /**
     * Return number of rows in database table.
     * @param {string} tableName
     * @returns {Promise<number>}
     */
    public getRowCount (tableName: string): Promise<number> {
        logger.debug(`DatabaseManager::getRowCount - retrieving number of rows from "${this._filename}" in table ${tableName}...`);

        return new Promise((resolve, reject) => {
            const sql = `SELECT COUNT(*) as count FROM ${tableName}`;
            this._database.get(sql, (err, row: any) => {
                if (err) {
                    logger.error(`DatabaseManager::getRowCount - failed to retrieve from "${this._filename}"! (${err.name}: ${err.message})`);
                    reject(err);
                }
                resolve(row.count);
            });
        });
    }

    /**
     * Return array of scoreIDs of duplicate scores.
     * @param {string} tableName
     * @returns {Promise<MORScore[]>}
     */
    public async getDuplicateScores (tableName: string): Promise<MORScore[]> {
        logger.debug(`DatabaseManager::getDuplicateScores - searching table ${tableName} from "${this._filename}" for duplicate scores...`);

        return new Promise((resolve, reject) => {
            const sql = `SELECT t1.*
                    FROM ${tableName} t1
                    JOIN ${tableName} t2 ON
                    t1.${MORScoreKey.USER_ID} = t2.${MORScoreKey.USER_ID} AND
                    t1.${MORScoreKey.BEATMAP_ID} = t2.${MORScoreKey.BEATMAP_ID} AND
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
                    logger.error(`DatabaseManager::getDuplicateScores - failed to retrieve from "${this._filename}"! (${err.name}: ${err.message})`);
                    reject(err);
                }
                resolve(rows);
            });
        });
    }

    public async scoreExistsInTable (scoreID: MORScore[MORScoreKey.SCORE_ID], tableName: string): Promise<boolean> {
        logger.debug(`DatabaseManager::scoreExistsInTable - searching for score ${scoreID} in table ${tableName} from "${this._filename}"...`);

        return new Promise((resolve, reject) => {
            const sql = `SELECT COUNT(*) AS count FROM ${tableName} WHERE ${MORScoreKey.SCORE_ID} = ?`;
            const params = [ scoreID ];
            this._database.get(sql, params, (err, row: { count: number }) => {
                if (err) {
                    logger.error(`DatabaseManager::scoreExistsInTable - failed to search for score ${scoreID} in table ${tableName} from "${this._filename}"! (${err.name}: ${err.message})`);
                    reject(err);
                }
                resolve(row.count > 0);
            });
        });
    }

    /**
     * Remove score.
     * @param {MORScore[MORScoreKey.SCORE_ID]} scoreID
     * @param {string} tableName
     * @returns {Promise<void>}
     */
    public async removeScore (scoreID: MORScore[MORScoreKey.SCORE_ID], tableName: string): Promise<void> {
        logger.debug(`DatabaseManager::removeScore - removing score ${scoreID} from table ${tableName} in "${this._filename}"...`);

        return new Promise((resolve, reject) => {
            const sql = `DELETE FROM ${tableName} WHERE ${MORScoreKey.SCORE_ID} = ?`;
            const params = [ scoreID ];
            this._database.run(sql, params, (err) => {
                if (err) {
                    logger.error(`DatabaseManager::removeScore - failed to remove score ${scoreID} from table ${tableName} in "${this._filename}"! (${err.name}: ${err.message})`);
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
    public async getTableScores (tableName: string): Promise<MORScore[]> {
        logger.debug(`DatabaseManager::getTableScores - retrieving scores from table ${tableName} in "${this._filename}"...`);

        return new Promise((resolve, reject) => {
            const sql = `SELECT * FROM ${tableName}`;
            this._database.all(sql, (err, rows: MORScore[]) => {
                if (err) {
                    logger.error(`DatabaseManager::getTableScores - failed to retrieve from "${this._filename}"! (${err.name}: ${err.message})`);
                    reject(err);
                }
                resolve(rows);
            });
        });
    }

    /**
     * Return all scores.
     * @returns {Promise<MORScore[]>}
     */
    public async getScores (): Promise<MORScore[]> {
        logger.debug(`DatabaseManager::getScores - retrieving scores from "${this._filename}"...`);

        return new Promise((resolve, reject) => {
            const keys: string[] = Object.values(MORMod);
            const sql = `SELECT * FROM ${keys.join(' UNION ALL SELECT * FROM ')}`;
            this._database.all(sql, (err, rows: MORScore[]) => {
                if (err) {
                    logger.error(`DatabaseManager::getScores - failed to retrieve from "${this._filename}"! (${err.name}: ${err.message})`);
                    reject(err);
                }
                resolve(rows);
            });
        });
    }

    /**
     * Update database score.
     * @param {MORScore} score
     * @returns {Promise<void>}
     */
    public async updateScore (score: MORScore): Promise<void> {
        logger.debug(`DatabaseManager::updateScore - updating "${this._filename}" score ${score[MORScoreKey.SCORE_ID]}...`);

        return new Promise((resolve, reject) => {
            const sql = `UPDATE ${convertOsuMods(modStringToArray(score[MORScoreKey.MODS]))} SET
                ${MORScoreKey.USER_ID} = ?,
                ${MORScoreKey.BEATMAP_ID} = ?,
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
                score[MORScoreKey.BEATMAP_ID],
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
                    logger.error(`DatabaseManager::updateScore - failed to update score ${scoreID} in "${this._filename}"! (${err.name}: ${err.message})`);
                    reject(err);
                }
                resolve();
            });
        });
    }

    /**
     * Return all users.
     * @returns {Promise<MORUser[]>}
     */
    public async getUsers (): Promise<MORUser[]> {
        logger.debug(`DatabaseManager::getUsers - retrieving users from ${MORDatabaseSpecialKey.USERS} in "${this._filename}"...`);

        return new Promise((resolve, reject) => {
            const sql = `SELECT * FROM ${MORDatabaseSpecialKey.USERS}`;
            this._database.all(sql, (err, rows: MORUser[]) => {
                if (err) {
                    logger.error(`DatabaseManager::getUsers - failed to retrieve from "${this._filename}"! (${err.name}: ${err.message})`);
                    reject(err);
                }
                resolve(rows);
            });
        });
    }

    /**
     * Update database user.
     * @param {MORUser} user
     * @returns {Promise<void>}
     */
    public async updateUser (user: MORUser): Promise<void> {
        logger.debug(`DatabaseManager::updateUser - updating "${this._filename}" user ${user[MORUserKey.USER_ID]}...`);

        return new Promise((resolve, reject) => {
            const sql = `UPDATE ${MORDatabaseSpecialKey.USERS} SET
                ${MORUserKey.USERNAME} = ?,
                ${MORUserKey.COUNTRY_CODE} = ?,
                ${MORUserKey.GLOBAL_RANK} = ?,
                ${MORUserKey.PP} = ?,
                ${MORUserKey.ACCURACY} = ?,
                ${MORUserKey.PLAYTIME} = ?,
                ${MORUserKey.PLAYCOUNT} = ?,
                ${MORUserKey.RANKED_SCORE} = ?,
                ${MORUserKey.MAX_COMBO} = ?,
                ${MORUserKey.REPLAYS_WATCHED} = ?,
                ${MORUserKey.PFP_IMAGE_URL} = ?,
                ${MORUserKey.TOP_1S} = ?,
                ${MORUserKey.TOP_2S} = ?,
                ${MORUserKey.TOP_3S} = ?,
                ${MORUserKey.AUTOTRACK} = ?
                WHERE ${MORUserKey.USER_ID} = ?;`;
            const data = [
                user[MORUserKey.USERNAME],
                user[MORUserKey.COUNTRY_CODE],
                user[MORUserKey.GLOBAL_RANK],
                user[MORUserKey.PP],
                user[MORUserKey.ACCURACY],
                user[MORUserKey.PLAYTIME],
                user[MORUserKey.PLAYCOUNT],
                user[MORUserKey.RANKED_SCORE],
                user[MORUserKey.MAX_COMBO],
                user[MORUserKey.REPLAYS_WATCHED],
                user[MORUserKey.PFP_IMAGE_URL],
                user[MORUserKey.TOP_1S],
                user[MORUserKey.TOP_2S],
                user[MORUserKey.TOP_3S],
                user[MORUserKey.AUTOTRACK],
                user[MORUserKey.USER_ID]
            ];
            const userID = user[MORUserKey.USER_ID];
            this._database.run(sql, data, (err) => {
                if (err) {
                    logger.error(`DatabaseManager::updateUser - failed to update user ${userID} in "${this._filename}"! (${err.name}: ${err.message})`);
                    reject(err);
                }
                resolve();
            });
        });
    }

    /**
     * Insert user into database.
     * @param {MORUser} user
     * @returns {Promise<void>}
     */
    public async insertUser (user: MORUser): Promise<void> {
        logger.debug(`DatabaseManager::insertUser - inserting user ${user[MORUserKey.USER_ID]} into "${this._filename}"...`);

        return new Promise((resolve, reject) => {
            const sql = `INSERT INTO ${MORDatabaseSpecialKey.USERS} (
                ${MORUserKey.USER_ID},
                ${MORUserKey.USERNAME},
                ${MORUserKey.COUNTRY_CODE},
                ${MORUserKey.GLOBAL_RANK},
                ${MORUserKey.PP},
                ${MORUserKey.ACCURACY},
                ${MORUserKey.PLAYTIME},
                ${MORUserKey.PLAYCOUNT},
                ${MORUserKey.RANKED_SCORE},
                ${MORUserKey.MAX_COMBO},
                ${MORUserKey.REPLAYS_WATCHED},
                ${MORUserKey.PFP_IMAGE_URL},
                ${MORUserKey.TOP_1S},
                ${MORUserKey.TOP_2S},
                ${MORUserKey.TOP_3S},
                ${MORUserKey.AUTOTRACK}
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
            const params = [
                user[MORUserKey.USER_ID],
                user[MORUserKey.USERNAME],
                user[MORUserKey.COUNTRY_CODE],
                user[MORUserKey.GLOBAL_RANK],
                user[MORUserKey.PP],
                user[MORUserKey.ACCURACY],
                user[MORUserKey.PLAYTIME],
                user[MORUserKey.PLAYCOUNT],
                user[MORUserKey.RANKED_SCORE],
                user[MORUserKey.MAX_COMBO],
                user[MORUserKey.REPLAYS_WATCHED],
                user[MORUserKey.PFP_IMAGE_URL],
                user[MORUserKey.TOP_1S],
                user[MORUserKey.TOP_2S],
                user[MORUserKey.TOP_3S],
                user[MORUserKey.AUTOTRACK]
            ];
            this._database.run(sql, params, (err) => {
                if (err) {
                    if (err.message.includes('UNIQUE')) {
                        logger.debug(`DatabaseManager::insertUser - skipping user ${user[MORUserKey.USER_ID]}; already exists in "${this._filename}"...`);
                        resolve();
                    } else {
                        logger.error(`DatabaseManager::insertUser - failed to insert user ${user[MORUserKey.USER_ID]} into "${this._filename}"! (${err.name}: ${err.message})`);
                        reject(err);
                    }
                }
                resolve();
            });
        });
    }

    /**
     * Remove user.
     * @param {number} userID
     * @returns {Promise<void>}
     */
    public async removeUser (userID: MORUser[MORUserKey.USER_ID]): Promise<void> {
        logger.debug(`DatabaseManager::removeUser - removing user ${userID} from "${this._filename}"...`);

        return new Promise((resolve, reject) => {
            const sql = `DELETE FROM ${MORDatabaseSpecialKey.USERS} WHERE ${MORUserKey.USER_ID} = ?`;
            const params = [ userID ];
            this._database.run(sql, params, (err) => {
                if (err) {
                    logger.error(`DatabaseManager::removeUser - failed to remove user ${userID} from "${this._filename}"! (${err.name}: ${err.message})`);
                    reject(err);
                }
                resolve();
            });
        });
    }

    /**
     * Remove scores set by user.
     * @param {MORUser[MORUserKey.USER_ID]} userID
     * @returns {Promise<void>}
     */
    public async removeUserScores (userID: MORUser[MORUserKey.USER_ID]): Promise<void> {
        logger.debug(`DatabaseManager::removeUserScores - removing scores set by ${userID} from "${this._filename}"...`);

        return new Promise((resolve, reject) => {
            for (const key in MORMod) {
                const sql = `DELETE FROM ${key} WHERE ${MORUserKey.USER_ID} = ?`;
                const params = [ userID ];
                this._database.run(sql, params, (err) => {
                    if (err) {
                        logger.error(`DatabaseManager::removeUserScores - failed to remove scores by ${userID} from "${this._filename}"! (${err.name}: ${err.message})`);
                        reject(err);
                    }
                });
            }
            resolve();
        });
    }

    /* ------------------------------------------------------------------------------------------------------------------------------------ */
    /* ---------------------------------------------------------------PRIVATE-------------------------------------------------------------- */
    /* ------------------------------------------------------------------------------------------------------------------------------------ */
}
