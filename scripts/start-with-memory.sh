#!/bin/bash

# This script starts the application with increased memory limits to prevent out-of-memory errors

# Set the maximum heap size to 4GB 
# Adjust this value based on your system's available memory
export NODE_OPTIONS="--max-old-space-size=4096"

# Run your application using the appropriate command
# For development
echo "Starting application with increased memory limit (4GB)"
yarn dev

# For production build, uncomment the following line and comment the dev line above
# yarn build && yarn preview 