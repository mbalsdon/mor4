import { defined, sleep, OAuthToken, OsuRequestHeader, OsuScoreType, OsuMod } from './util/Common.js';
import MORConfig from './util/MORConfig.js';
import { ConstructorError, TokenError } from './util/MORErrors.js';

import './util/Logger.js';
import { loggers } from 'winston';
const logger = loggers.get('logger');

/**
 * Client wrapper for osu!API.
 * @see {@link https://osu.ppy.sh/docs/}
 */
export default class OsuWrapper {
    private static TOKEN_URL = new URL('https://osu.ppy.sh/oauth/token');
    private static API_URL = new URL('https://osu.ppy.sh/api/v2');
    private static TOKEN_REQUEST: RequestInit = {
        method: 'POST',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            client_id: MORConfig.OSU_API_CLIENT_ID,
            client_secret: MORConfig.OSU_API_CLIENT_SECRET,
            grant_type: 'client_credentials',
            scope: 'public'
        })
    };

    private _accessToken: string;
    private _accessTokenDuration: number;
    private _accessTokenAcquiryTime: number;

    /* ------------------------------------------------------------------ */
    /* ------------------------------PUBLIC------------------------------ */
    /* ------------------------------------------------------------------ */

    /**
     * Retrieve osu!API OAuth token and construct OsuWrapper.
     * @returns {Promise<OsuWrapper>}
     */
    public static async build (): Promise<OsuWrapper> {
        logger.info('OsuWrapper::build - building OsuWrapper...');

        const token = await OsuWrapper.getAccessToken();
        if (!defined(token)) {
            throw new ConstructorError('Osuwrapper::build - failed to update token!');
        }

        return new OsuWrapper(<OAuthToken>token);
    }

    /**
     * Retrieve osu! user data.
     * @param {string[]} userIDs
     * @returns {Promise<any>} [UserCompact](https://osu.ppy.sh/docs/index.html#usercompact)
     */
    public async getUsers (userIDs: string[]): Promise<any> {
        logger.debug(`OsuWrapper::getUsers - retrieving users [${userIDs}]`);
        if (userIDs.length > 50) {
            logger.warn(`OsuWrapper::getUsers - only up to 50 users can be retrieved at once! userIDs.length = ${userIDs.length}`);
        }

        const url = new URL(`${OsuWrapper.API_URL}/users`);
        for (const ID of userIDs) {
            url.searchParams.append('ids[]', ID);
        }
        const request: RequestInit = {
            method: 'GET',
            headers: this.buildHeaders()
        };

        await this.refreshToken();
        return OsuWrapper.makeRequest(url, request);
    }

    /**
     * Retrieve osu! score data.
     * @param {string} scoreID
     * @param {number} maxRetries
     * @param {number} baseSeconds
     * @returns {Promise<any>} [Score](https://osu.ppy.sh/docs/index.html#score)
     */
    public async getScore (scoreID: string, maxRetries = 3, baseSeconds = 3): Promise<any> {
        logger.debug(`OsuWrapper::getScore - retrieving score ${scoreID}`);

        const url = new URL(`${OsuWrapper.API_URL}/scores/osu/${scoreID}`);
        url.searchParams.append('key', 'id');
        const request: RequestInit = {
            method: 'GET',
            headers: this.buildHeaders()
        };

        await this.refreshToken();
        return OsuWrapper.makeRequest(url, request, maxRetries, baseSeconds);
    }

    /**
     * Retrieve osu! user scores data.
     * @param {string} userID
     * @param {OsuScoreType} type
     * @returns {Promise<any>} [Score[]](https://osu.ppy.sh/docs/index.html#score)
     */
    public async getUserScores (userID: string, type: OsuScoreType = OsuScoreType.BEST): Promise<any> {
        logger.debug(`OsuWrapper::getUserScores - retrieving ${type} scores for user ${userID}`);

        const url = new URL(`${OsuWrapper.API_URL}/users/${userID}/scores/${type}`);
        url.searchParams.append('mode', 'osu');
        url.searchParams.append('limit', '100');
        const request: RequestInit = {
            method: 'GET',
            headers: this.buildHeaders()
        };

        await this.refreshToken();
        return OsuWrapper.makeRequest(url, request);
    }

    /**
     * Retrieve osu! beatmap data.
     * @param {string} beatmapID
     * @returns {Promise<any>} [Beatmap](https://osu.ppy.sh/docs/index.html#beatmap)
     */
    public async getBeatmap (beatmapID: string): Promise<any> {
        logger.debug(`OsuWrapper::getBeatmap - retrieving beatmap ${beatmapID}`);

        const url = new URL(`${OsuWrapper.API_URL}/beatmaps/${beatmapID}`);
        const request: RequestInit = {
            method: 'GET',
            headers: this.buildHeaders()
        };

        await this.refreshToken();
        return OsuWrapper.makeRequest(url, request);
    }

    /**
     * Retrieve osu! beatmap attribute data.
     * @param {number} beatmapID
     * @param {OsuMod[]} mods
     * @returns {Promise<any>} [BeatmapDifficultyAttributes](https://osu.ppy.sh/docs/index.html#beatmapdifficultyattributes)
     */
    public async getBeatmapAttributes (beatmapID: number, mods: OsuMod[]): Promise<any> {
        logger.debug(`OsuWrapper:getBeatmapAttributes - retrieving attributes for beatmap ${beatmapID} with mods [${mods}]`);

        const url = new URL(`${OsuWrapper.API_URL}/beatmaps/${beatmapID}/attributes`);
        const request: RequestInit = {
            method: 'POST',
            headers: this.buildHeaders(),
            body: JSON.stringify({
                mods,
                ruleset: 'osu'
            })
        };

        await this.refreshToken();
        return OsuWrapper.makeRequest(url, request);
    }

    /* ------------------------------------------------------------------ */
    /* ------------------------------PRIVATE----------------------------- */
    /* ------------------------------------------------------------------ */

    /**
     * Constructs the client.
     * Not meant to be called directly - use OsuWrapper.build() instead!
     * @param {OAuthToken} token
     */
    private constructor (token: OAuthToken) {
        this._accessToken = token.access_token;
        this._accessTokenDuration = token.expires_in;
        this._accessTokenAcquiryTime = Math.floor(new Date().getTime() / 1000);
    }

    /**
     * Build standard osu!API request headers.
     * @returns {OsuRequestHeader}
     */
    private buildHeaders (): OsuRequestHeader {
        return {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this._accessToken}`
        };
    }

    /**
     * Retrieve osu!API OAuth token.
     * @returns {Promise<OAuthToken>}
     */
    private static async getAccessToken (): Promise<OAuthToken> {
        logger.debug('OsuWrapper::getAccessToken - retrieving access token...');

        const token = await OsuWrapper.makeRequest(OsuWrapper.TOKEN_URL, OsuWrapper.TOKEN_REQUEST, 4, 3);
        if (!defined(token)) {
            throw new TokenError('OsuWrapper::getAccessToken - failed to regenerate access token; is the osu!API down?');
        }

        return token;
    }

    /**
     * Check if token is expired, update if it is.
     * @returns {Promise<void>}
     */
    private async refreshToken (): Promise<void> {
        const currentTime = Math.floor(new Date().getTime() / 1000);
        if (currentTime > this._accessTokenAcquiryTime + this._accessTokenDuration) {
            logger.info('OsuWrapper::refreshToken - token expired! Attempting to refresh...');

            const token = await OsuWrapper.makeRequest(OsuWrapper.TOKEN_URL, OsuWrapper.TOKEN_REQUEST);
            if (!defined(token)) {
                throw new TokenError('OsuWrapper::refreshToken - failed to regenerate access token; is the osu!API down?');
            }

            this._accessToken = token.access_token;
            this._accessTokenDuration = token.expires_in;
            this._accessTokenAcquiryTime = currentTime;
        }

        return;
    }

    /**
     * Make fetch request.
     * If request fails, attempt again up to specified number of tries.
     * Uses exponential backoff to calculate time between requests.
     * Return undefined if all attempted requests fail.
     * @param {URL} url
     * @param {RequestInit} request
     * @param {number} maxRetries
     * @param {number} baseSeconds
     * @returns {Promise<any>}
     */
    private static async makeRequest (url: URL, request: RequestInit, maxRetries = 3, baseSeconds = 3): Promise<any> {
        let retries = 0;
        let delayMs = MORConfig.OSU_API_COOLDOWN_MS;

        while (retries < maxRetries) {
            await sleep(delayMs);
            const response = await fetch(url, request);

            if (response.ok) {
                return response.json();
            } else {
                logger.warn(`OsuWrapper::makeRequest - received "${response.status} - ${response.statusText}"`);
                ++retries;
                delayMs = Math.pow(baseSeconds, retries) * 1000;
                if (retries < maxRetries) {
                    logger.warn(`OsuWrapper::makeRequest - request failed; retrying in ${delayMs}ms`);
                }
            }
        }

        logger.warn('OsuWrapper::makeRequest - exceeded the maximum number of retries. Aborting...');
        return undefined;
    }
}
