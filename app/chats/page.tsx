"use client";

import BottomNav from "@/components/BottomNav";
import ChatListPane from "@/components/ChatListPane";

export default function ChatsPage() {
  return (
    <div className="flex flex-1 flex-col">
      <main className="flex-1 px-4 pt-5 pb-4">
        <ChatListPane />
      </main>

      <BottomNav />
    </div>
  );
}
