#!/bin/bash
# --platform skips the interactive platform prompt; "1" picks the first league
# --all exercises the whole report; the menu is the default interactive path
echo "1" | npm start -- --platform sleeper --username gruidlp --all
