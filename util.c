#include "config.h"

#define DEFAULT_SEED 0xACE1u

unsigned short seed = DEFAULT_SEED;

unsigned short rand() {
    unsigned short bit = (
        (seed >> 0) ^ (seed >> 2) ^ (seed >> 3) ^ (seed >> 5)
    ) & 1;
    return seed = (seed >> 1) | (bit << 15);
}

#define randf() \
    ((float)rand() / (float)0xFFFF)
