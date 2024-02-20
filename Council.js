


async askQuestion(question, councilID) {
    let assistant = await this.openai.beta.assistants.retrieve("asst_wMvKw4yfH8rn0Uv9yAPn1UMb")
    let councilWisdom = await this.getThreads(councilID)
    //for each thread, create a message
    for (let i = 0; i < councilWisdom.threads.length; i++) {
        let message = await this.openai.beta.threads.messages.create(councilWisdom.threads[i].id, {
            role: "user",
            content: question
        })
    }
    let runs = []
    for (let i = 0; i < councilWisdom.threads.length; i++) {
            runs[i] = await this.openai.beta.threads.runs.create(councilWisdom.threads[i].id, {
            assistant_id: assistant.id ,
            instructions:council[i]
        });
    }
    let runStatus;
    // Polling mechanism to see if runStatus is completed
    // This should be made more robust.
    while (true) {
        let returned = 0
        await new Promise((resolve) => setTimeout(resolve, 2000));
        for (let i = 0; i < councilWisdom.threads.length; i++) {
            runStatus = await this.openai.beta.threads.runs.retrieve(councilWisdom.threads[i].id, runs[i].id);
            if (runStatus.status == "completed")
                returned += 1
        }
        console.log(returned)
        if (returned == councilWisdom.threads.length)
            break
    }

    for (let i = 0; i < councilWisdom.threads.length; i++) {
        // Get the latest messages from the thread
        const messages = await this.openai.beta.threads.messages.list(councilWisdom.threads[i].id)
        const answer = messages.data[0].content[0].text.value
        councilWisdom.wisdom.push(answer)
    }
    let summary = await this.summarize(councilWisdom.wisdom.join('\n'))
    //await this.db.open('wisdom', { indexBy: 'id' }).put(councilWisdom)
    console.log(councilWisdom.wisdom)
    console.log('--------------------')
    console.log(summary)
    return summary
}

async getCellInfo(id){
    let cellInfo = await this.db.get('cell',id)
    if (!cellInfo) {
        cellInfo = emptycell(id)
        await this.db.put('cell', cellInfo)
    }
    return cellInfo
    
}

async getThreads(id) {
    let cell = await this.getCellInfo(id)
     if (!cell.threads) {
         //create 12 threads
         let threads = []
         for (let i = 0; i < 12; i++) {
             threads.push(await this.openai.beta.threads.create())
         }
         cell.threads = threads
     }
     return cell
 }