/**
 * Return true if x is undefined, false otherwise.
 * @param {any} x
 * @returns {boolean}
 */
export function defined (x: any): boolean {
    return ((typeof x !== 'undefined') && (x !== 'undefined'));
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
export type OsuRequestHeaders = {
    Accept: string,
    'Content-Type': string,
    Authorization: string
}

/**
 * osu!API score type.
 */
export type OsuScoreType = 'best' | 'firsts' | 'recent'

/**
 * osu!API mods.
 */
export type OsuMod = 'EZ' | 'NF' | 'HT' | 'SO' | 'HR' | 'SD' | 'PF' | 'DT' | 'NC' | 'HD' | 'FL'
