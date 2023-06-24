/**
 * Signifies that object construction did not succeed.
 */
export class ConstructorError extends Error {
    public constructor (message: string) {
        super(message);
        this.name = this.constructor.name;
    }
}

/**
 * Signifies issues with access token.
 */
export class TokenError extends Error {
    public constructor (message: string) {
        super(message);
        this.name = this.constructor.name;
    }
}
