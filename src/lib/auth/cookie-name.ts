/** Browsers share cookies across ports on one host, so a second copy of the
 *  app on another port would read the session of this one. The name is
 *  port-specific for that reason. Edge-safe: the middleware imports it. */
export const SESSION_COOKIE = process.env.PORT && process.env.PORT !== '3117' ? `waypoint_user_${process.env.PORT}` : 'waypoint_user';
