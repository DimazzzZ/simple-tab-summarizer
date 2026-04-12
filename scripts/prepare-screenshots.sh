#!/usr/bin/env bash

for img in ../screenshots/raw/*.png; do
  convert "$img" \
    -resize 1280x800 \
    -background "#848586" \
    -gravity center \
    -extent 1280x800 \
    "../screenshots/$(basename "${img%.*}").png"
done
