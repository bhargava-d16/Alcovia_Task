/**
 * CircularTimer — animated SVG countdown ring.
 *
 * Uses react-native-svg's Svg + Circle.
 * The progress ring animates the stroke-dashoffset to show remaining time.
 * On web, SVG is native so there's no performance overhead.
 *
 * Props:
 * - progress: 0 (empty) to 1 (full)
 * - timeLeft: seconds remaining (displayed in center)
 * - size: diameter in pixels (default 260)
 * - color: ring color (default primary blue)
 */

import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';
import { Colors, Typography } from '../constants/design';

interface Props {
  progress: number;  // 0 to 1
  timeLeft: number;  // seconds
  size?: number;
  color?: string;
  isRunning?: boolean;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export default function CircularTimer({
  progress,
  timeLeft,
  size = 260,
  color = Colors.primary,
  isRunning = false,
}: Props) {
  const strokeWidth = 10;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const cx = size / 2;
  const cy = size / 2;

  // Animate the dashoffset when progress changes
  const animatedProgress = useRef(new Animated.Value(progress)).current;

  useEffect(() => {
    Animated.timing(animatedProgress, {
      toValue: progress,
      duration: 250,
      useNativeDriver: false, // SVG props can't use native driver
    }).start();
  }, [progress]);

  const strokeDashoffset = animatedProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [circumference, 0],
  });

  const isIdle = !isRunning && progress === 0;
  const displayColor = isIdle ? Colors.border : color;

  return (
    <View style={[styles.container, { width: size, height: size }]}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        {/* Background track */}
        <Circle
          cx={cx}
          cy={cy}
          r={radius}
          stroke={Colors.border}
          strokeWidth={strokeWidth}
          fill="none"
        />
        {/* Animated progress ring */}
        <G rotation="-90" origin={`${cx}, ${cy}`}>
          <AnimatedCircle
            cx={cx}
            cy={cy}
            r={radius}
            stroke={displayColor}
            strokeWidth={strokeWidth}
            fill="none"
            strokeDasharray={`${circumference} ${circumference}`}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
          />
        </G>
      </Svg>

      {/* Center content */}
      <View style={styles.center}>
        <Text style={[styles.time, { color: isIdle ? Colors.textSecondary : Colors.textPrimary }]}>
          {formatTime(timeLeft)}
        </Text>
        {isRunning && (
          <Text style={styles.label}>FOCUSING</Text>
        )}
        {!isRunning && progress === 0 && (
          <Text style={styles.label}>READY</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  time: {
    ...Typography.timer,
    letterSpacing: -2,
  },
  label: {
    ...Typography.label,
    color: Colors.textSecondary,
    marginTop: 4,
    letterSpacing: 2,
  },
});
