#include "hero_animation.h"

/* Sprite entry: signed x, signed y, CHR tile index, NES OAM attributes. */
const Png2ChrAnimationMetaspriteTile hero_animation_sprites[] = {
    { 0, 0, 0x00, 0x00 },
    { 8, 0, 0x02, 0x00 },
    { 0, 0, 0x00, 0x00 },
    { 8, 0, 0x02, 0x40 },
    { 0, 0, 0x01, 0x00 },
    { 8, 0, 0x03, 0x00 },
    { 0, 0, 0x01, 0x80 },
    { 8, 0, 0x03, 0x40 },
    { -8, 0, 0x01, 0x40 },
    { -16, 0, 0x03, 0x40 },
    { -8, 0, 0x01, 0xC0 },
    { -16, 0, 0x03, 0x00 },
};

/* Frame entry: sprite-array offset, sprite count, duration in game frames. */
const Png2ChrAnimationFrame hero_animation_frames[] = {
    { 0, 2, 12 },
    { 2, 2, 18 },
    { 4, 2, 6 },
    { 6, 2, 6 },
    { 8, 2, 6 },
    { 10, 2, 6 },
};

/* Animation entry: frame offset, count, size, type, direction/flip flags. */
const Png2ChrAnimation hero_animation_animations[] = {
    { 0, 2, 2, 2, 0, 0x00 },
    { 2, 2, 2, 2, 1, 0x02 },
    { 4, 2, 2, 2, 1, 0x81 },
};

const uint8_t hero_animation_animation_count = 3;
