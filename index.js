const assert = require("assert");
const querystring = require("querystring");
const uuid = require("uuid");
const { OAuth2Client } = require("google-auth-library");

const redirect = async (res, location) => {
  res.statusCode = 307;
  res.setHeader("Location", location);
  res.end();
};

const provider = "google";
/**
 * OpenID 2.0 compliance:
 * https://developers.google.com/identity/protocols/OpenIDConnect?hl=en#discovery
 */
const SCOPES = ["openid", "email", "profile"];
const USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";

const microAuthGoogle = ({
  clientId,
  clientSecret,
  callbackUrl,
  path = "/",
  scopes = [],
  accessType = "offline"
}) => {
  assert(clientId, "Must provide a clientId.");
  assert(clientSecret, "Must provide a clientSecret.");
  assert(callbackUrl, "Must provide a callbackUrl.");
  assert(path, "Must provide an url path.");

  const { host, protocol, pathname } = new URL(callbackUrl);
  assert(protocol, "Not a valid protocol in the callbackUrl string.");
  assert(host, "Not a valid host in the callbackUrl string.");
  assert(pathname, "Not a valid path in the callbackUrl string.");
  assert(
    path !== pathname,
    "Service path cannot be the same as callback path."
  );

  const client = new OAuth2Client(clientId, clientSecret, callbackUrl);
  const scope = [...new Set(SCOPES.concat(scopes))];
  const states = [];

  return fn => async (req, res, ...args) => {
    let url;

    try {
      url = new URL(`${protocol}//${host}${req.url}`);
    } catch (err) {
      args[0] = { err, provider };

      return fn(req, res, ...args);
    }

    if (url.pathname === path) {
      try {
        const stateDefault = (args||[])[0]?.state;
        const state = stateDefault || uuid.v4();

        states.push(state);

        const redirectUrl = client.generateAuthUrl({
          // eslint-disable-next-line camelcase
          access_type: accessType,
          scope,
          state
        });

        return redirect(res, redirectUrl);
      } catch (err) {
        args[0] = { err, provider };

        return fn(req, res, ...args);
      }
    }

    if (url.pathname === pathname) {
      try {
        const { state, code } = querystring.parse(url.search.slice(1));

        if (!states.includes(state)) {
          const err = new Error("Invalid state");

          args[0] = { err, provider };

          return fn(req, res, ...args);
        }

        states.splice(states.indexOf(state), 1);

        const { tokens, error } = await client.getToken(code);

        if (error) {
          args[0] = { err: error, provider };

          return fn(req, res, ...args);
        }

        client.setCredentials(tokens);

        const { data } = await client.requestAsync({
          url: USERINFO_URL
        });

        const result = {
          provider,
          state,
          info: data,
          client
        };

        args[0] = {result};

        return fn(req, res, ...args);
      } catch (err) {
        args[0] = { err, provider };

        return fn(req, res, ...args);
      }
    }

    return fn(req, res, ...args);
  };
};

module.exports = microAuthGoogle;
