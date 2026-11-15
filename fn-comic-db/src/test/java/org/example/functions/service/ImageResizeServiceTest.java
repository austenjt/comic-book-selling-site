package org.example.functions.service;

import org.junit.jupiter.api.Test;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.InputStream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Regression tests for {@link ImageResizeService} decoding.
 *
 * <p>Commons Imaging 1.0.0-alpha6 ignores JPEG restart markers (DRI/RSTn). It loses
 * entropy-decoder sync at the first restart interval and returns a garbage image
 * <em>without throwing</em> — uploads of iOS camera-roll photos, which routinely carry
 * restart markers, came out as a solid blue wash. {@code ImageResizeService} therefore
 * decodes via {@code ImageIO} and keeps Commons Imaging only as a fallback.</p>
 *
 * <p>The fixture {@code restart-markers.jpg} is a 64x64 baseline JPEG written by
 * {@code cjpeg -restart 1}: a solid red left half (220,30,40) and a solid blue right half
 * (30,60,210). Decoded correctly, each half is flat; decoded without restart-marker
 * handling, both halves turn to noise.</p>
 */
class ImageResizeServiceTest {

    private static final int RED_LEFT   = 0xdc1e28;   // 220, 30, 40
    private static final int BLUE_RIGHT = 0x1e3cd2;   //  30, 60, 210

    /** Per-channel tolerance to absorb JPEG quantisation and the resampling passes. */
    private static final int TOLERANCE = 12;

    private byte[] fixture() throws Exception {
        try (InputStream in = getClass().getResourceAsStream("/restart-markers.jpg")) {
            assertNotNull(in, "test fixture restart-markers.jpg is missing");
            return in.readAllBytes();
        }
    }

    private static void assertColorNear(int expectedRgb, int actualArgb, String where) {
        int er = (expectedRgb >> 16) & 0xFF, eg = (expectedRgb >> 8) & 0xFF, eb = expectedRgb & 0xFF;
        int ar = (actualArgb  >> 16) & 0xFF, ag = (actualArgb  >> 8) & 0xFF, ab = actualArgb  & 0xFF;
        String detail = String.format("%s: expected ~#%06x but was #%06x", where, expectedRgb, actualArgb & 0xFFFFFF);
        assertTrue(Math.abs(er - ar) <= TOLERANCE, detail);
        assertTrue(Math.abs(eg - ag) <= TOLERANCE, detail);
        assertTrue(Math.abs(eb - ab) <= TOLERANCE, detail);
    }

    @Test
    void resizeToHeightPreservesColorsOfJpegWithRestartMarkers() throws Exception {
        byte[] resized = ImageResizeService.getServiceInstance().resizeToHeight(fixture(), 32);

        BufferedImage img = ImageIO.read(new ByteArrayInputStream(resized));
        assertNotNull(img, "resized output should be a readable image");
        assertEquals(32, img.getHeight());
        assertEquals(32, img.getWidth(), "square input should stay square");

        // Sample well inside each half so the red/blue seam never contributes.
        assertColorNear(RED_LEFT,   img.getRGB(8, 8),   "top-left");
        assertColorNear(RED_LEFT,   img.getRGB(8, 24),  "bottom-left");
        assertColorNear(BLUE_RIGHT, img.getRGB(24, 8),  "top-right");
        assertColorNear(BLUE_RIGHT, img.getRGB(24, 24), "bottom-right");
    }

    @Test
    void resizeIfTooTallReturnsOriginalBytesWhenAlreadyShortEnough() throws Exception {
        byte[] original = fixture();
        assertEquals(original.length, ImageResizeService.getServiceInstance()
            .resizeIfTooTall(original, 900).length, "a 64px-tall image should pass through untouched");
    }

    @Test
    void resizeIfTooTallScalesDownAndKeepsColors() throws Exception {
        byte[] resized = ImageResizeService.getServiceInstance().resizeIfTooTall(fixture(), 16);

        BufferedImage img = ImageIO.read(new ByteArrayInputStream(resized));
        assertNotNull(img);
        assertEquals(16, img.getHeight());
        assertColorNear(RED_LEFT,   img.getRGB(4, 8),  "left half");
        assertColorNear(BLUE_RIGHT, img.getRGB(12, 8), "right half");
    }
}
