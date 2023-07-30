import { JobCallback } from 'node-schedule';
import OsuWrapper from '../OsuWrapper.js';

import './Logger.js';
import { loggers } from 'winston';
const logger = loggers.get('logger');

/* ------------------------------------------------------------------------------------------------------------------------------------ */
/* --------------------------------------------------------------FUNCTIONS------------------------------------------------------------- */
/* ------------------------------------------------------------------------------------------------------------------------------------ */

/**
 * Return true if x is undefined, false otherwise.
 * @param {any} x
 * @returns {boolean}
 */
export function defined (x: any): boolean {
    return ((typeof x !== 'undefined') && (x !== undefined));
}

/**
 * Return true if x is null, false otherwise.
 * @param {any} x
 * @returns {boolean}
 */
export function isNull (x: any): boolean {
    return (x === null);
}

/**
 * Sleep for given number of milliseconds.
 * @param ms
 * @returns {Promise<void>}
 */
export function sleep (ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Return true if input is numeric string, false otherwise.
 * @param {string} x
 * @returns {boolean}
 */
export function isNumericString (x: string): boolean {
    return ((typeof parseInt(x) === 'number') && !isNaN(parseInt(x)));
}

/**
 * Returns true if input is positive numeric string, false otherwise.
 * @param {string} x
 * @returns {boolean}
 */
export function isPositiveNumericString (x: string): boolean {
    return (isNumericString(x) && (parseInt(x) > 0));
}

/**
 * Returns MOR beatmap string given osu!API score.
 * @param {any} score [Score](https://osu.ppy.sh/docs/index.html#score)
 */
export function getMORBeatmapString (score: any): string {
    return `${score.beatmapset.artist} - ${score.beatmapset.title} [${score.beatmap.version}]`;
}

/**
 * Convert string to associated OsuMod.
 * @param {string} s
 * @returns {OsuMod}
 */
export function stringToOsuMod (s: string): OsuMod {
    for (const key in OsuMod) {
        const mod = OsuMod[key as keyof typeof OsuMod];
        if (s === mod) {
            return mod;
        }
    }
    throw new TypeError(`stringToOsuMod - ${s} has no associated OsuMod!`);
}

/**
 * Convert string to associated MORMod.
 * @param {string} s
 * @returns {MORMod}
 */
export function stringToMORMod (s: string): MORMod {
    for (const key in MORMod) {
        const mod = MORMod[key as keyof typeof MORMod];
        if (s === mod) {
            return mod;
        }
    }
    throw new TypeError(`stringToMORMod - ${s} has no associated MORMod!`);
}

/**
 * Convert array of osu! mods and return MORMod equivalent.
 * @param {string[]} mods
 * @returns {MORMod}
 */
export function convertOsuMods (mods: string[]): MORMod {
    // Sort the array for easy conversion to MORMod
    const sortedMods = sortOsuMods(mods);

    let pMods = sortedMods.join().replaceAll(',', '');
    pMods = pMods.replace(OsuMod.NC.toString(), OsuMod.DT.toString());
    pMods = pMods.replace(OsuMod.NF.toString(), '');
    pMods = pMods.replace(OsuMod.SO.toString(), '');
    pMods = pMods.replace(OsuMod.SD.toString(), '');
    pMods = pMods.replace(OsuMod.PF.toString(), '');
    pMods = (pMods === '') ? 'NM' : pMods;

    return stringToMORMod(pMods);
}

/**
 * Return sorted array of osu! mods.
 * @param {string[]} mods
 * @returns {void}
 */
export function sortOsuMods (mods: string[]): string[] {
    const modOrder: string[] = [
        OsuMod.NF,
        OsuMod.EZ,
        OsuMod.HD,
        OsuMod.HR,
        OsuMod.SD,
        OsuMod.DT,
        OsuMod.NC,
        OsuMod.HT,
        OsuMod.FL,
        OsuMod.SO,
        OsuMod.PF
    ];

    const sortedMods = [ ...mods ].filter((mod) => mod !== 'NM');
    sortedMods.sort((a, b) => {
        const aIdx = modOrder.indexOf(a);
        const bIdx = modOrder.indexOf(b);
        if (aIdx === -1 && bIdx === -1) {
            return 0;
        } else if (aIdx === -1) {
            return 1;
        } else if (bIdx === -1) {
            return -1;
        } else {
            return aIdx - bIdx;
        }
    });

    return sortedMods;
}

/**
 * Convert mod string to array of individual mod strings.
 * @param {string} mods
 * @returns {string[]}
 */
export function modStringToArray (mods: string): string[] {
    return mods.match(/.{1,2}/g) || [];
}

/**
 * Return true if osu! mods affect beatmap SR, false otherwise.
 * @param {string[]} mods
 * @returns {boolean}
 */
export function affectsStarRating (mods: string[]): boolean {
    return (mods.includes(OsuMod.DT.toString()) ||
            mods.includes(OsuMod.HR.toString()) ||
            mods.includes(OsuMod.EZ.toString()) ||
            mods.includes(OsuMod.HT.toString()) ||
            mods.includes(OsuMod.FL.toString()));
}

/**
 * Convert osu!API score to MORScore
 * @param {any} osu [Score](https://osu.ppy.sh/docs/index.html#score)
 * @param {OsuWrapper} osuScore
 * @returns {Promise<MORScore>}
 */
export async function osuScoreToMORScore (osu: OsuWrapper, osuScore: any): Promise<MORScore> {
    logger.debug(`Common::osuScoreToMORScore - converting osu! score "${osuScore.id}"...`);

    const mods: string[] = osuScore.mods;
    let starRating = osuScore.beatmap.difficulty_rating;
    if (affectsStarRating(mods)) {
        const difficultyAttributes = await osu.getBeatmapAttributes(osuScore.beatmap.id, mods.map((x: string) => stringToOsuMod(x)));
        starRating = difficultyAttributes.attributes.star_rating;
    }

    const morScore: MORScore = {
        [MORScoreKey.SCORE_ID]: osuScore.id,
        [MORScoreKey.USER_ID]: osuScore.user.id,
        [MORScoreKey.BEATMAP_ID]: osuScore.beatmap.id,
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

/* ------------------------------------------------------------------------------------------------------------------------------------ */
/* ----------------------------------------------------------------TYPES--------------------------------------------------------------- */
/* ------------------------------------------------------------------------------------------------------------------------------------ */

/**
 * [OAuth2 Reference](https://www.oauth.com/oauth2-servers/access-tokens/access-token-response/)
 */
export type OAuthToken = {
    access_token: string,
    token_type: string,
    expires_in: number,
    refresh_token: string,
    scope?: string
}

/**
 * osu!API request headers.
 */
export type OsuRequestHeader = {
    Accept: string,
    'Content-Type': string,
    Authorization: string
}

/**
 * osu!API score type.
 */
export enum OsuScoreType {
    BEST = 'best',
    FIRST = 'firsts',
    RECENT = 'recent',
    PINNED = 'pinned'
}

/**
 * osu!API mods.
 */
export enum OsuMod {
    EZ = 'EZ',
    NF = 'NF',
    HT = 'HT',
    SO = 'SO',
    HR = 'HR',
    SD = 'SD',
    PF = 'PF',
    DT = 'DT',
    NC = 'NC',
    HD = 'HD',
    FL = 'FL'
}

/**
 * MOR database non-score keys.
 */
export enum MORDatabaseSpecialKey {
    USERS = 'USERS'
}

/**
 * Valid MOR mods.
 */
export enum MORMod {
    NM = 'NM',
    DT = 'DT',
    HR = 'HR',
    HD = 'HD',
    EZ = 'EZ',
    HT = 'HT',
    FL = 'FL',
    HDDT = 'HDDT',
    HRDT = 'HRDT',
    EZDT = 'EZDT',
    DTFL = 'DTFL',
    EZHT = 'EZHT',
    HDHR = 'HDHR',
    HDHT = 'HDHT',
    EZHD = 'EZHD',
    HRHT = 'HRHT',
    EZFL = 'EZFL',
    HRFL = 'HRFL',
    HTFL = 'HTFL',
    HDFL = 'HDFL',
    HDHRDT = 'HDHRDT',
    HDDTFL = 'HDDTFL',
    EZHDDT = 'EZHDDT',
    HRDTFL = 'HRDTFL',
    EZDTFL = 'EZDTFL',
    HDHTFL = 'HDHTFL',
    HDHRHT = 'HDHRHT',
    HRHTFL = 'HRHTFL',
    EZHDHT = 'EZHDHT',
    EZHTFL = 'EZHTFL',
    EZHDFL = 'EZHDFL',
    HDHRFL = 'HDHRFL',
    HDHRDTFL = 'HDHRDTFL',
    EZHDDTFL = 'EZHDDTFL',
    EZHDHTFL = 'EZHDHTFL',
    HDHRHTFL = 'HDHRHTFL'
}

/**
 * MORUser keys.
 */
export enum MORUserKey {
    USER_ID = 'userID',
    USERNAME = 'username',
    COUNTRY_CODE = 'countryCode',
    GLOBAL_RANK = 'globalRank',
    PP = 'pp',
    ACCURACY = 'accuracy',
    PLAYTIME = 'playtime',
    PLAYCOUNT = 'playcount',
    RANKED_SCORE = 'rankedScore',
    MAX_COMBO = 'maxCombo',
    REPLAYS_WATCHED = 'replaysWatched',
    PFP_IMAGE_URL =  'pfpImageURL',
    TOP_1S = 'top1s',
    TOP_2S = 'top2s',
    TOP_3S = 'top3s',
    AUTOTRACK = 'autotrack'
}

/**
 * MOR user.
 */
export type MORUser = {
    [MORUserKey.USER_ID]: number
    [MORUserKey.USERNAME]: string
    [MORUserKey.COUNTRY_CODE]: string
    [MORUserKey.GLOBAL_RANK]: number
    [MORUserKey.PP]: number
    [MORUserKey.ACCURACY]: number
    [MORUserKey.PLAYTIME]: number
    [MORUserKey.PLAYCOUNT]: number
    [MORUserKey.RANKED_SCORE]: number
    [MORUserKey.MAX_COMBO]: number,
    [MORUserKey.REPLAYS_WATCHED]: number
    [MORUserKey.PFP_IMAGE_URL]: string
    [MORUserKey.TOP_1S]: number
    [MORUserKey.TOP_2S]: number
    [MORUserKey.TOP_3S]: number
    [MORUserKey.AUTOTRACK]: boolean
}

/**
 * MORScore keys.
 */
export enum MORScoreKey {
    SCORE_ID = 'scoreID',
    USER_ID = 'userID',
    BEATMAP_ID = 'beatmapID',
    USERNAME = 'username',
    BEATMAP = 'beatmap',
    MODS = 'mods',
    PP = 'pp',
    ACCURACY = 'accuracy',
    STAR_RATING = 'starRating',
    DATE = 'date',
    BEATMAP_IMAGE_URL = 'beatmapImageURL'
}

/**
 * MOR score.
 */
export type MORScore = {
    [MORScoreKey.SCORE_ID]: number
    [MORScoreKey.USER_ID]: number
    [MORScoreKey.BEATMAP_ID]: number,
    [MORScoreKey.USERNAME]: string
    [MORScoreKey.BEATMAP]: string
    [MORScoreKey.MODS]: string
    [MORScoreKey.PP]: number
    [MORScoreKey.ACCURACY]: number
    [MORScoreKey.STAR_RATING]: number
    [MORScoreKey.DATE]: string
    [MORScoreKey.BEATMAP_IMAGE_URL]: string
}

/**
 * MORJob keys.
 */
export enum MORJobKey {
    NAME = 'name',
    RULE = 'rule',
    CALLBACK = 'callback'
}

/**
 * MOR job.
 */
export type MORJob = {
    [MORJobKey.NAME]: string,
    [MORJobKey.RULE]: string,
    [MORJobKey.CALLBACK]: JobCallback
}
