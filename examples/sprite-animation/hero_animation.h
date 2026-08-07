#ifndef HERO_ANIMATION_H
#define HERO_ANIMATION_H

#include <stdint.h>

#ifndef PNG2CHR_ANIMATION_FORMAT_CONSTANTS
#define PNG2CHR_ANIMATION_FORMAT_CONSTANTS
#define NES_SPRITE_FLIP_HORIZONTAL 0x40
#define NES_SPRITE_FLIP_VERTICAL 0x80
#define ANIMATION_TYPE_IDLE 0
#define ANIMATION_TYPE_MOVEMENT 1
#define ANIMATION_DIRECTION_NONE 0x00
#define ANIMATION_DIRECTION_LEFT 0x01
#define ANIMATION_DIRECTION_RIGHT 0x02
#define ANIMATION_DIRECTION_MASK 0x03
#define ANIMATION_GENERATED_H_FLIP 0x80
#endif

#ifndef PNG2CHR_ANIMATION_FORMAT_TYPES
#define PNG2CHR_ANIMATION_FORMAT_TYPES
typedef struct {
    int8_t x;
    int8_t y;
    uint8_t tile;
    uint8_t attributes;
} Png2ChrAnimationMetaspriteTile;

typedef struct {
    uint16_t sprite_offset;
    uint8_t sprite_count;
    uint8_t duration;
} Png2ChrAnimationFrame;

typedef struct {
    uint16_t frame_offset;
    uint8_t frame_count;
    uint8_t width_tiles;
    uint8_t height_tiles;
    uint8_t type;
    uint8_t direction_flags;
} Png2ChrAnimation;
#endif

extern const Png2ChrAnimationMetaspriteTile hero_animation_sprites[];
extern const Png2ChrAnimationFrame hero_animation_frames[];
extern const Png2ChrAnimation hero_animation_animations[];
extern const uint8_t hero_animation_animation_count;

#endif
