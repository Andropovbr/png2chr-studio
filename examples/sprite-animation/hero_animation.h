#ifndef HERO_ANIMATION_H
#define HERO_ANIMATION_H

#include <stdint.h>

#define NES_SPRITE_FLIP_HORIZONTAL 0x40
#define NES_SPRITE_FLIP_VERTICAL 0x80
#define HERO_ANIMATION_IDLE 0
#define HERO_ANIMATION_MOVEMENT 1
#define HERO_DIRECTION_NONE 0x00
#define HERO_DIRECTION_LEFT 0x01
#define HERO_DIRECTION_RIGHT 0x02
#define HERO_DIRECTION_MASK 0x03
#define HERO_GENERATED_H_FLIP 0x80

typedef struct {
    int8_t x;
    int8_t y;
    uint8_t tile;
    uint8_t attributes;
} HeroMetaspriteTile;

typedef struct {
    uint16_t sprite_offset;
    uint8_t sprite_count;
    uint8_t duration;
} HeroAnimationFrame;

typedef struct {
    uint16_t frame_offset;
    uint8_t frame_count;
    uint8_t width_tiles;
    uint8_t height_tiles;
    uint8_t type;
    uint8_t direction_flags;
} HeroAnimation;

extern const HeroMetaspriteTile hero_animation_sprites[];
extern const HeroAnimationFrame hero_animation_frames[];
extern const HeroAnimation hero_animations[];
extern const uint8_t hero_animation_count;

#endif
