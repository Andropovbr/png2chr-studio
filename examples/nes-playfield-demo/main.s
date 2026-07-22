PPUCTRL   = $2000
PPUMASK   = $2001
PPUSTATUS = $2002
OAMADDR   = $2003
PPUSCROLL = $2005
PPUADDR   = $2006
PPUDATA   = $2007
OAMDMA    = $4014
JOY1      = $4016

BUTTON_UP    = $08
BUTTON_DOWN  = $04
BUTTON_LEFT  = $02
BUTTON_RIGHT = $01
PLAYER_TILE  = 6

.segment "HEADER"
    .byte "NES", $1A
    .byte 1                       ; 16 KiB PRG ROM
    .byte 1                       ; 8 KiB CHR ROM
    .byte $00, $00                ; mapper 0, horizontal mirroring
    .res 8, $00

.segment "ZEROPAGE"
player_x:    .res 1
player_y:    .res 1
candidate_x: .res 1
candidate_y: .res 1
pad_state:   .res 1
pixel_x:     .res 1
row_offset:  .res 1

.segment "OAM"
oam: .res 256

.segment "CODE"
.proc reset
    sei
    cld
    ldx #$40
    stx $4017
    ldx #$FF
    txs
    inx
    stx PPUCTRL
    stx PPUMASK
    stx $4010

    bit PPUSTATUS
@wait_vblank_1:
    bit PPUSTATUS
    bpl @wait_vblank_1
@wait_vblank_2:
    bit PPUSTATUS
    bpl @wait_vblank_2

    lda #$FF
    ldx #$00
@clear_oam:
    sta oam, x
    inx
    bne @clear_oam

    lda #120
    sta player_x
    lda #112
    sta player_y
    jsr update_oam
    jsr load_palette
    jsr load_playfield

    lda #$00
    sta PPUSCROLL
    sta PPUSCROLL
    lda #%10000000              ; NMI on, both pattern tables at $0000
    sta PPUCTRL
    lda #%00011110              ; show background and sprites
    sta PPUMASK

@forever:
    jmp @forever
.endproc

.proc load_palette
    bit PPUSTATUS
    lda #$3F
    sta PPUADDR
    lda #$00
    sta PPUADDR
    ldx #$00
@copy:
    lda palette_data, x
    sta PPUDATA
    inx
    cpx #32
    bne @copy
    rts
.endproc

.proc load_playfield
    bit PPUSTATUS
    lda #$20
    sta PPUADDR
    lda #$00
    sta PPUADDR
    ldx #$00
@nametable_page_0:
    lda nametable_data, x
    sta PPUDATA
    inx
    bne @nametable_page_0

@nametable_page_1:
    lda nametable_data + $100, x
    sta PPUDATA
    inx
    bne @nametable_page_1

@nametable_page_2:
    lda nametable_data + $200, x
    sta PPUDATA
    inx
    bne @nametable_page_2

    ldx #$00
@nametable_tail:
    lda nametable_data + $300, x
    sta PPUDATA
    inx
    cpx #$C0
    bne @nametable_tail

    ldx #$00
@attributes:
    lda attribute_data, x
    sta PPUDATA
    inx
    cpx #64
    bne @attributes
    rts
.endproc

.proc read_controller
    lda #$01
    sta JOY1
    lda #$00
    sta JOY1
    sta pad_state
    ldx #8
@read_bit:
    lda JOY1
    lsr a
    rol pad_state
    dex
    bne @read_bit
    rts
.endproc

.proc update_player
    lda pad_state
    and #BUTTON_UP
    beq @down
    lda player_y
    cmp #1
    beq @down
    sec
    sbc #1
    sta candidate_y
    lda player_x
    sta candidate_x
    jsr accept_candidate
@down:
    lda pad_state
    and #BUTTON_DOWN
    beq @left
    lda player_y
    cmp #232
    beq @left
    clc
    adc #1
    sta candidate_y
    lda player_x
    sta candidate_x
    jsr accept_candidate
@left:
    lda pad_state
    and #BUTTON_LEFT
    beq @right
    lda player_x
    beq @right
    sec
    sbc #1
    sta candidate_x
    lda player_y
    sta candidate_y
    jsr accept_candidate
@right:
    lda pad_state
    and #BUTTON_RIGHT
    beq @done
    lda player_x
    cmp #248
    beq @done
    clc
    adc #1
    sta candidate_x
    lda player_y
    sta candidate_y
    jsr accept_candidate
@done:
    rts
.endproc

.proc accept_candidate
    jsr candidate_is_blocked
    bcs @blocked
    lda candidate_x
    sta player_x
    lda candidate_y
    sta player_y
@blocked:
    rts
.endproc

.proc candidate_is_blocked
    lda candidate_x
    ldx candidate_y
    jsr pixel_is_solid
    bne @blocked

    lda candidate_x
    clc
    adc #7
    ldx candidate_y
    jsr pixel_is_solid
    bne @blocked

    lda candidate_x
    ldx candidate_y
    inx
    inx
    inx
    inx
    inx
    inx
    inx
    jsr pixel_is_solid
    bne @blocked

    lda candidate_x
    clc
    adc #7
    ldx candidate_y
    inx
    inx
    inx
    inx
    inx
    inx
    inx
    jsr pixel_is_solid
    bne @blocked

    clc
    rts
@blocked:
    sec
    rts
.endproc

; A = pixel X, X = pixel Y. Returns Z clear when the collision bit is set.
.proc pixel_is_solid
    sta pixel_x
    txa
    lsr a
    lsr a
    lsr a
    asl a
    asl a
    sta row_offset

    lda pixel_x
    lsr a
    lsr a
    lsr a
    pha
    lsr a
    lsr a
    lsr a
    clc
    adc row_offset
    tay
    pla
    and #$07
    tax
    lda collision_data, y
    and bit_masks, x
    rts
.endproc

.proc update_oam
    lda player_y
    sec
    sbc #1
    sta oam
    lda #PLAYER_TILE
    sta oam + 1
    lda #$00
    sta oam + 2
    lda player_x
    sta oam + 3
    rts
.endproc

.proc nmi
    pha
    txa
    pha
    tya
    pha

    jsr read_controller
    jsr update_player
    jsr update_oam
    lda #$00
    sta OAMADDR
    lda #$02
    sta OAMDMA
    lda #$00
    sta PPUSCROLL
    sta PPUSCROLL

    pla
    tay
    pla
    tax
    pla
    rti
.endproc

.proc irq
    rti
.endproc

.segment "RODATA"
palette_data:
    .byte $0F, $11, $21, $30,  $0F, $11, $21, $30
    .byte $0F, $11, $21, $30,  $0F, $11, $21, $30
    .byte $0F, $30, $16, $27,  $0F, $30, $16, $27
    .byte $0F, $30, $16, $27,  $0F, $30, $16, $27

bit_masks:
    .byte $80, $40, $20, $10, $08, $04, $02, $01

nametable_data:
    .incbin "random-playfield.nam"
attribute_data:
    .incbin "random-playfield.atr"
collision_data:
    .incbin "random-playfield.col"

.segment "VECTORS"
    .word nmi, reset, irq

.segment "CHR"
    .incbin "random-playfield.chr"
player_tile:
    .byte %00111100
    .byte %01111110
    .byte %11011011
    .byte %11111111
    .byte %00111100
    .byte %01111110
    .byte %10100101
    .byte %10000001
    .byte %00111100
    .byte %01111110
    .byte %11011011
    .byte %11111111
    .byte %00111100
    .byte %01111110
    .byte %10100101
    .byte %10000001
    .res 8192 - 96 - 16, $00
