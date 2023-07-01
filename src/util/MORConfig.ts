import { readFileSync } from 'fs';

/**
 * Wrapper class for local configuration settings.
 */
export default class MORConfig {
    private static _cfg = JSON.parse(readFileSync('./mor_config.json').toString());

    public static LOG_LEVEL = this._cfg.LOG_LEVEL;
    public static LOG_ROTATE_TIME = this._cfg.LOG_ROTATE_TIME;
    public static LOG_DATE_PATTERN = this._cfg.LOG_DATE_PATTERN;
    public static LOG_FILEPATH = this._cfg.LOG_FILEPATH;

    public static OSU_API_CLIENT_ID = this._cfg.OSU_API_CLIENT_ID;
    public static OSU_API_CLIENT_SECRET = this._cfg.OSU_API_CLIENT_SECRET;
    public static OSU_API_COOLDOWN_MS = this._cfg.OSU_API_COOLDOWN_MS;

    public static DB_FILEPATH = this._cfg.DB_FILEPATH;
}
