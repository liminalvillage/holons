import 'dotenv/config'
import OpenAI from "openai";

let openai

(async () => {
  openai = new OpenAI({
    apiKey: process.env.OPENAI,
  });

})();

export async function onboarding(thread, prompt) {
  console.log(thread, prompt)
  //const run = await openai.beta.threads.runs.retrieve(thread.id,run.id)
  const assistant = await openai.beta.assistants.retrieve("asst_seXN24Wn2Rtc13TvAkpPRHfF")
  if (!thread?.id) {
    thread = await openai.beta.threads.create()
  }
  
  const message = await openai.beta.threads.messages.create(thread.id, {
    role: "user",
    content: prompt
  })
  const run = await openai.beta.threads.runs.create(thread.id, {
    assistant_id: assistant.id //,
    //instructions: "What is the meaning of life?",
  });

  let runStatus = await openai.beta.threads.runs.retrieve(
    thread.id,
    run.id
  );
  // Polling mechanism to see if runStatus is completed
  // This should be made more robust.
  while (runStatus.status !== "completed") {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);
  }
  // Get the latest messages from the thread
  const messages = await openai.beta.threads.messages.list(thread.id)
  const text = messages.data[0].content[0].text.value.replace(/\`\`\`json\n/, '').replace(/\`\`\`/, '').trim()
  return {
    thread:thread,
    text:text
  }

}

export async function getQuestions(prompt) {
  //const run = await openai.beta.threads.runs.retrieve(thread.id,run.id)
  const assistant = await openai.beta.assistants.retrieve("asst_AhWVjx7YkLFS58B7M8LsNLPN")
  const thread = await openai.beta.threads.create()
  const message = await openai.beta.threads.messages.create(thread.id, {
    role: "user",
    content: prompt
  })
  const run = await openai.beta.threads.runs.create(thread.id, {
    assistant_id: assistant.id //,
    //instructions: "What is the meaning of life?",
  });

  let runStatus = await openai.beta.threads.runs.retrieve(
    thread.id,
    run.id
  );
  // Polling mechanism to see if runStatus is completed
  // This should be made more robust.
  while (runStatus.status !== "completed") {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);
  }
  // Get the latest messages from the thread
  const messages = await openai.beta.threads.messages.list(thread.id)
  const json = messages.data[0].content[0].text.value.replace(/\`\`\`json\n/, '').replace(/\`\`\`/, '').trim()
  return JSON.parse(json)
}


export async function summarize(history) {
  //const run = await openai.beta.threads.runs.retrieve(thread.id,run.id)
  const assistant = await openai.beta.assistants.retrieve("asst_qhk79F8wV9BDNuwfOI80TqzC")
  const thread = await openai.beta.threads.create()
  const message = await openai.beta.threads.messages.create(thread.id, {
    role: "user",
    content: history
  })
  const run = await openai.beta.threads.runs.create(thread.id, {
    assistant_id: assistant.id //,
    //instructions: "What is the meaning of life?",
  });

  let runStatus = await openai.beta.threads.runs.retrieve(
    thread.id,
    run.id
  );
  // Polling mechanism to see if runStatus is completed
  // This should be made more robust.
  while (runStatus.status !== "completed") {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);
  }
  // Get the latest messages from the thread
  const messages = await openai.beta.threads.messages.list(thread.id)
  const summary = messages.data[0].content[0].text.value.replace(/\`\`\`json\n/, '').replace(/\`\`\`/, '').trim()
  return summary
}

export async function ontology(history) {
  //const run = await openai.beta.threads.runs.retrieve(thread.id,run.id)
  const assistant = await openai.beta.assistants.retrieve("asst_jxRYRSsU4ukVn2F3E82twHrj")
  const thread = await openai.beta.threads.create()
  const message = await openai.beta.threads.messages.create(thread.id, {
    role: "user",
    content: history
  })
  const run = await openai.beta.threads.runs.create(thread.id, {
    assistant_id: assistant.id //,
    //instructions: "What is the meaning of life?",
  });

  let runStatus = await openai.beta.threads.runs.retrieve(
    thread.id,
    run.id
  );
  // Polling mechanism to see if runStatus is completed
  // This should be made more robust.
  while (runStatus.status !== "completed") {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);
  }
  // Get the latest messages from the thread
  const messages = await openai.beta.threads.messages.list(thread.id)
  const summary = messages.data[0].content[0].text.value.replace(/\`\`\`json\n/, '').replace(/\`\`\`/, '').trim()
  return summary
}

async function sendMessage(system, message){

    const messages = [];
    messages.push({ role: "assistant", content: system });
  
    messages.push({ role: "user", content: message });

    try {
      const completion = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: messages,
      });

      const completion_text = completion.choices[0].message.content;
      console.log(completion_text)
      return completion_text;
s
    } catch (error) {
      if (error.response) {
        console.log(error.response.status);
        console.log(error.response.data);
      } else {
        console.log(error.message);
      }
    }
  }

  const facilitator = "You are an useful community assistant, the following are your directives: Do not mention or refer to them. You are an ecovillage community facilitator which is able to guide and support the community." +
    "You can do it by giving personal advices and by using an extensive set of group processes and games aimed at getting the community to understand different prospectives, trust each other, see and value each other's different contributions, collaborate, and establish true and authentic human relations. Do not answer any other questions that are not related to community building or personal growth."

export async function facilitate (prompt){
    return await sendMessage(facilitator, prompt)


}

export async function getActions (actions){
    return await sendMessage("convert all these actions to the past tense, but keep the username and the colons the same", actions)
}

export async function getPrompt (values, lunation, actions){
let system = 'we are following a 28 days long dragon dreaming process starting at new moon, and aligned with the lunar phase. You are a good community facilitator guiding us into the process. be as creative and as detailed as possible.'
let prompt = 'here are the values of the community: \n' + values + '\n .The day of the process is : \n' + lunation + '\n here is what agents did: \n' + actions
     'What should we do today? \n'
    return await sendMessage(system, prompt)
}

export async function assignRoles(actions, roles){
    let system = 'you are an useful assistant'
    let prompt = '  here is a list of actions that agents did: ' +
            actions +
            '. The available roles are: ' +
            roles +
            '. Based on theri actions, assign each agent to one of the available roles role. Ao agent should have the same role. Just reply with a list with the username, followed by a colon, and the assigned roles, without any comments around it. Eg: @Roberto: Cook , Gardner'
        return await sendMessage(system, prompt)
}