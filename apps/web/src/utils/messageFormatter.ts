// Utility to parse and format AI messages with stage directions
export interface FormattedMessage {
  stageDirections?: string;
  characterVoice?: string;
  advisor?: string;
}

export function parseMessageWithStageDirections(content: string): FormattedMessage {
  // Look for stage directions in [brackets] at the beginning
  const stageDirectionMatch = content.match(/^\[([^\]]+)\]/);
  
  if (stageDirectionMatch) {
    const stageDirections = stageDirectionMatch[1];
    const characterVoice = content.substring(stageDirectionMatch[0].length).trim();
    
    return {
      stageDirections,
      characterVoice: characterVoice || undefined
    };
  }
  
  // If no stage directions, return the content as character voice
  return {
    characterVoice: content
  };
}

export function formatMessageForDisplay(content: string, advisor?: string): FormattedMessage {
  const parsed = parseMessageWithStageDirections(content);
  
  return {
    ...parsed,
    advisor
  };
} 