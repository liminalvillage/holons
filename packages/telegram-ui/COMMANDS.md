# HolonsBot Commands Documentation

## Task Management
- `/task [description]` - Creates a new task
  - Example: `/task do the dishes`
- `/tasks` - Lists currently open tasks
- `/actions` - Lists the history of completed tasks

## Recognition & Value System
- `/appreciate [@user] [reason]` - Sends appreciation to the listed user
  - Example: `/appreciate @laura for taking care of the garden`
- `/status` - Shows rank of user according to the value points
- `/weights` - Changes the points assigned to each action

## Needs & Offers
- `/request [description]` - Something you would like to have
  - Example: `/request foot massage`
- `/offer [description]` - Something you would like to give
  - Example: `/offer yoga sessions`
- `/board` - Lists all users' requests and offers

## Community & Facilitation
- `/prompt` - Indicates the day of the current lunation, together with a suggested team activity
- `/facilitate [issue]` - Gives advice on community issues
  - Example: `/facilitate i don't feel recognized`
- `/bigtalk` - Get to know each other better by collectively answering the prompt

## Shifts (Elinor-compatible)
Shifts are read from a Nostr relay in the [Elinor](https://elinor.commonshub.dev/docs) format (kind 31923 occurrences, kind 31925 signups); any Elinor client sees the same signups.
- `/shifts [today|tomorrow|week|YYYY-MM-DD]` - Lists this chat's shifts with ✋ Take / ❌ Drop buttons
  - Example: `/shifts tomorrow`
- `/myshifts` - Lists the shifts you are signed up for in the next two weeks

## Role Management
- `/assignroles` - Assigns roles to members of the community based on their actions
- `/setroles [roles]` - Defines roles within the community
  - Example: `/setroles cook, gardener`

## Shopping & Expenses
- `/buy [item]` - Adds an item to the shopping list
  - Example: `/buy milk`
- `/shopping` - Displays the shopping list as clickable items
- `/spent` - Submits an expense
- `/balance` - Prints balance table

## Personal Values & Needs
- `/ivalue` - Allows to specify the list of values for the user
- `/values [@users]` - Visualizes the shared values of the specified users, or of all users
- `/ineed` - Allows to specify the list of needs for the user
- `/needs [@users]` - Visualizes the shared needs of the specified users, or of all users

## Holon Management
- `/restart` - Resets everything
- `/spoon` - Federates chats, bringing together actions, offers and needs
- `/fork` - Unbinds federated chats
- `/federate` - Federates with another holon

## Content Management
- `/tag [tag]` - Saves content under the specified tag
- `/publish` - Saves the content in the holosphere
- `/cast` - Saves the content on every scale in the holosphere
- `/summarize` - Listens to the conversation and summarises it when `/done` is entered

## System & Interface
- `/checklists` - Opens up the list of checklists
- `/settings` - Opens up the configuration interface
- `/dashboard` - A direct link to the web dashboard 