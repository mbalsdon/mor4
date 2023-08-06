import { readFileSync } from 'fs';

/**
 * Wrapper class for local configuration settings.
 */
export default class MORConfig {
    private static _CFG = JSON.parse(readFileSync('./config/mor4_config.json').toString());

    public static LOG_LEVEL = this._CFG.LOG_LEVEL || 'info';
    public static LOG_ROTATE_TIME = this._CFG.LOG_ROTATE_TIME || '1d';
    public static LOG_DATE_PATTERN = this._CFG.LOG_DATE_PATTERN || 'YYYY-MM-DD';
    public static LOG_FILEPATH = this._CFG.LOG_FILEPATH || './logs/mor4_%DATE%.log';

    public static OSU_API_COOLDOWN_MS = this._CFG.OSU_API_COOLDOWN_MS || 1000;

    public static DISCORD_API_CLIENT_ID = this._CFG.DISCORD_API_CLIENT_ID;
    public static DISCORD_API_BOT_TOKEN = this._CFG.DISCORD_API_BOT_TOKEN;

    public static DISCORD_BOT_EMBED_COLOR = this._CFG.DISCORD_BOT_EMBED_COLOR || 16713190;
    public static DISCORD_BOT_ICON_URL = this._CFG.DISCORD_BOT_ICON_URL || 'https://spreadnuts.s-ul.eu/2aSbePed.png';

    // TODO: No longer hardcoded in the future?
    public static OSU_API_CLIENT_ID = this._CFG.OSU_API_CLIENT_ID;
    public static OSU_API_CLIENT_SECRET = this._CFG.OSU_API_CLIENT_SECRET;

    public static DISCORD_BOT_SERVER_NAME = this._CFG.DISCORD_BOT_SERVER_NAME || 'Mouse City';

    public static DB_FILEPATH = this._CFG.DB_FILEPATH || './data/Mouse City0.db';
}
