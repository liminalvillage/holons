// Use format "functionName_callbackData" with callback functions
export const getCallbackData = (ctx) => ctx.match[0].split("_")[1];

// Regular message & inline button answer
export const getUserId = (ctx) =>
  ctx?.update?.message?.from?.id || ctx?.update?.callback_query?.from?.id || 0;

export const getUser = (ctx) =>
  ctx?.update?.message?.from || ctx?.update?.callback_query?.from || 0;

export const getUserName = (ctx) =>
  ctx?.from?.first_name ||
  ctx?.chat?.first_name ||
  ctx?.from?.username ||
  ctx?.chat?.username ||
  ctx?.message?.from?.first_name ||
  ctx?.message?.chat?.first_name ||
  ctx?.callback_query?.from?.first_name ||
  ctx?.callback_query?.chat?.first_name ||
  ctx?.message?.from?.username ||
  ctx?.message?.chat?.username ||
  ctx?.callback_query?.from?.username ||
  ctx?.callback_query?.chat?.username ||
  ctx?.update?.message?.from?.first_name ||
  ctx?.update?.message?.chat?.first_name ||
  ctx?.update?.callback_query?.from?.first_name ||
  ctx?.update?.callback_query?.chat?.first_name ||
  ctx?.update?.message?.from?.username ||
  ctx?.update?.message?.chat?.username ||
  ctx?.update?.callback_query?.from?.username ||
  ctx?.update?.callback_query?.chat?.username ||
  "???";

export const getParseModeHTML = () => ({ parse_mode: "HTML" });
export const bold = (text) => `<b>${text}</b>`;
export const italic = (text) => `<i>${text}</i>`;
export const underline = (text) => `<u>${text}</u>`;

export const getUserInput = (ctx) => ctx?.update?.message?.text;
export const getParameters = (ctx) => ctx?.update?.message?.text.split(" ").slice(1).join(" ");

export const getChatId = (ctx) => ctx?.update?.message?.chat?.id || ctx?.update?.callback_query?.message?.chat?.id || 0;
