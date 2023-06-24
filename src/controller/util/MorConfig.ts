import { readFileSync } from 'fs';

/**
 * Wrapper class for local configuration settings.
 */
export default class MorConfig {
    private static cfg = JSON.parse(readFileSync('./mor_config.json').toString());

    public static LOG_LEVEL = this.cfg.LOG_LEVEL;
    public static LOG_ROTATE_TIME = this.cfg.LOG_ROTATE_TIME;
    public static LOG_DATE_PATTERN = this.cfg.LOG_DATE_PATTERN;
    public static LOG_FILENAME = this.cfg.LOG_FILENAME;

    public static OSU_API_CLIENT_ID = this.cfg.OSU_API_CLIENT_ID;
    public static OSU_API_CLIENT_SECRET = this.cfg.OSU_API_CLIENT_SECRET;
}
