
import { defined, sleep, OAuthToken, OsuRequestHeaders, OsuScoreType, OsuMod } from './util/Common.js';
import MorConfig from './util/MorConfig.js';
import { ConstructorError, TokenError } from './util/MorErrors.js';

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
            client_id: MorConfig.OSU_API_CLIENT_ID,
            client_secret: MorConfig.OSU_API_CLIENT_SECRET,
            grant_type: 'client_credentials',
            scope: 'public'
        })
    };

    private accessToken: string;
    private accessTokenDuration: number;
    private accessTokenAcquiryTime: number;

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
     * @returns {Promise<any>} [Score](https://osu.ppy.sh/docs/index.html#score)
     */
    public async getScore (scoreID: string): Promise<any> {
        logger.debug(`OsuWrapper::getScore - retrieving score ${scoreID}`);

        const url = new URL(`${OsuWrapper.API_URL}/scores/osu/${scoreID}`);
        url.searchParams.append('key', 'id');
        const request: RequestInit = {
            method: 'GET',
            headers: this.buildHeaders()
        };

        await this.refreshToken();
        return OsuWrapper.makeRequest(url, request);
    }

    /**
     * Retrieve osu! user scores data.
     * @param {string} userID
     * @param {OsuScoreType} type
     * @returns {Promise<any>} [Score[]](https://osu.ppy.sh/docs/index.html#score)
     */
    public async getUserScores (userID: string, type: OsuScoreType = 'best'): Promise<any> {
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
     * @param {string} beatmapID
     * @param {OsuMod[]} mods
     * @returns {Promise<any>} [BeatmapDifficultyAttributes](https://osu.ppy.sh/docs/index.html#beatmapdifficultyattributes)
     */
    public async getBeatmapAttributes (beatmapID: string, mods: OsuMod[]): Promise<any> {
        logger.debug(`OsuWrapper:getBeatmapAttributes - retrieving attributes for ${beatmapID} with mods [${mods}]`);

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
        this.accessToken = token.access_token;
        this.accessTokenDuration = token.expires_in;
        this.accessTokenAcquiryTime = Math.floor(new Date().getTime() / 1000);
    }

    /**
     * Build standard osu!API request headers.
     * @returns {OsuRequestHeaders}
     */
    private buildHeaders (): OsuRequestHeaders {
        return {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.accessToken}`
        };
    }

    /**
     * Retrieve osu!API OAuth token.
     * @returns {Promise<OAuthToken>}
     */
    private static async getAccessToken (): Promise<OAuthToken> {
        logger.debug('OsuWrapper::getAccessToken - retrieving access token...');

        const token = await OsuWrapper.makeRequest(OsuWrapper.TOKEN_URL, OsuWrapper.TOKEN_REQUEST, 4);
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
        if (currentTime > this.accessTokenAcquiryTime + this.accessTokenDuration) {
            logger.info('OsuWrapper::refreshToken - token expired! Attempting to refresh...');

            const token = await OsuWrapper.makeRequest(OsuWrapper.TOKEN_URL, OsuWrapper.TOKEN_REQUEST);
            if (!defined(token)) {
                throw new TokenError('OsuWrapper::refreshToken - failed to regenerate access token; is the osu!API down?');
            }

            this.accessToken = token.access_token;
            this.accessTokenDuration = token.expires_in;
            this.accessTokenAcquiryTime = currentTime;
        }

        return;
    }

    /**
     * Make fetch request.
     * If request fails, attempt again up to specified number of tries.
     * Uses exponential backoff to calculate time between requests with base of 3 seconds.
     * Return undefined if all attempted requests fail.
     * @param {URL} url
     * @param {RequestInit} request
     * @param {number} maxRetries
     * @returns {Promise<any>}
     */
    private static async makeRequest (url: URL, request: RequestInit, maxRetries = 3): Promise<any> {
        let retries = 0;
        let delaySec = 1;

        while (retries < maxRetries) {
            await sleep(delaySec * 1000);
            const response = await fetch(url, request);

            if (response.ok) {
                return response.json();
            } else {
                logger.warn(`OsuWrapper::makeRequest - received "${response.status} - ${response.statusText}"`);
                ++retries;
                delaySec = Math.pow(3, retries);
                if (retries < maxRetries) {
                    logger.warn(`OsuWrapper::makeRequest - request failed; retrying in ${delaySec}s`);
                }
            }
        }

        logger.warn('OsuWrapper::makeRequest - exceeded the maximum number of retries. Aborting...');
        return undefined;
    }
}
