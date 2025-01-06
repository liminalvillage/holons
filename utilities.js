import i18next from "i18next";

export { i18next };

// Use format "functionName_callbackData" with callback functions
export const getCallbackData = (ctx) => ctx.match[0].split("_")[1];

// Regular message & inline button answer
export const getUserId = (ctx) =>
  ctx?.update?.message?.from?.id || ctx?.update?.callback_query?.from?.id || 0;

export const getUser = (ctx) =>
  ctx?.update?.message?.from || ctx?.update?.callback_query?.from || 0;

export const getChatName = async (ctx, chatID) => {
  try {
    const chatInfo = await ctx.telegram.getChat(chatID);
    
    if (chatInfo.type === 'private') {
      return `${chatInfo.first_name} ${chatInfo.last_name || ''}`.trim();
    } else {
      return chatInfo.title || 'unknown';
    }
  } catch (err) {
    console.error('Error getting chat name:', err);
    return 'unknown';
  }
}

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

export const getChatId = (ctx) => ctx?.chat?.id || ctx?.update?.message?.chat?.id || ctx?.update?.callback_query?.message?.chat?.id || 0;
export const getMessageId = (ctx) => ctx?.message?.message_id || ctx?.update?.message?.message_id || ctx?.update?.callback_query?.message?.message_id || 0;

export const parseList = (text) => {
  // Split by comma
  text = text.split(' ').slice(1).join(' ')
  const items = text.split(',').map(item => item.trim());
  // Remove empty strings
  return items.filter(x => x);
}

export const capitalize = (string) => {
  return string.charAt(0).toUpperCase() + string.slice(1);
}

export const isAdmin = async (ctx) => {
  if (ctx.telegram) { // TODO: HANDLE DISCORD CASE
    const chatMember = await ctx.telegram.getChatMember(ctx.chat.id, ctx.from.id);
    if (['administrator', 'creator'].includes(chatMember.status) || (ctx.chat.type === 'private'))
      return true;
    else
      return false;
  }
  return false

}

export const getDisplayName = (user) => {
  if (!user) return "Unknown";
  
  const firstName = user.first_name || "";
  const lastName = user.last_name || "";
  
  if (!firstName && !lastName) return user.username || "Unknown";
  
  return firstName + (lastName ? ` ${lastName.charAt(0)}.` : "");
};
