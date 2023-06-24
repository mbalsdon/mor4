import MorConfig from './MorConfig.js';

import * as winston from 'winston';
import 'winston-daily-rotate-file';

const LEVEL = MorConfig.LOG_LEVEL || 'info';
const LOG_FILENAME = MorConfig.LOG_FILENAME || './logs/bot_%DATE%.log';
const DATE_PATTERN = MorConfig.LOG_DATE_PATTERN || 'YYYY-MM-DD';
const ROTATE_TIME = MorConfig.LOG_ROTATE_TIME || '3d';
const FORMAT = winston.format.combine(
    winston.format.errors({ stack: true }),
    winston.format.timestamp(),
    winston.format.simple()
);

winston.loggers.add('logger', {
    level: LEVEL,
    format: FORMAT,
    transports: [
        new winston.transports.DailyRotateFile({
            level: LEVEL,
            filename: LOG_FILENAME,
            datePattern: DATE_PATTERN,
            maxFiles: ROTATE_TIME
        }),
        new winston.transports.Console({
            level: LEVEL
        })
    ]
});
