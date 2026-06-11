import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { ClientProvider } from './src/context/ClientContext';
import { SyncProvider } from './src/context/SyncContext';
import HomeScreen from './src/screens/HomeScreen';
import SyllabusScreen from './src/screens/SyllabusScreen';
import DevPanel from './src/components/DevPanel';
import { Colors } from './src/constants/design';

const Tab = createBottomTabNavigator();

function TabIcon({ name, focused }: { name: string; focused: boolean }) {
  const icons: Record<string, string> = { Home: '⏱', Syllabus: '📚' };
  return (
    <Text style={{ fontSize: 20, opacity: focused ? 1 : 0.5 }}>
      {icons[name] ?? '?'}
    </Text>
  );
}

function AppTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused }) => (
          <TabIcon name={route.name} focused={focused} />
        ),
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.textSecondary,
        tabBarStyle: {
          backgroundColor: Colors.card,
          borderTopColor: Colors.border,
          height: 64,
          paddingBottom: 8,
        },
        tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
        headerStyle: { backgroundColor: Colors.surface },
        headerTitleStyle: { fontSize: 18, fontWeight: '700', color: Colors.textPrimary },
        headerShadowVisible: false,
      })}
    >
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{ headerShown: false }}
      />
      <Tab.Screen
        name="Syllabus"
        component={SyllabusScreen}
        options={{ headerShown: false }}
      />
    </Tab.Navigator>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ClientProvider>
        <SyncProvider>
          <NavigationContainer>
            <StatusBar style="dark" />
            <AppTabs />
            {/* Dev panel is always mounted — floating over all screens */}
            <DevPanel />
          </NavigationContainer>
        </SyncProvider>
      </ClientProvider>
    </SafeAreaProvider>
  );
}
