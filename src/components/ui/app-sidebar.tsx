'use client'

import { UserButton } from "@clerk/nextjs";
import { Sidebar, SidebarHeader, SidebarContent, SidebarSeparator, SidebarMenuItem, SidebarMenu } from "./sidebar";
import { useUser } from "@clerk/nextjs";
import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import Link from "next/link";
import { Trash2 } from "lucide-react";

const AppSidebar = () => {

    const { user } = useUser();
    const [chats, setChats] = useState<any>([]);

    const fetchChats = async () => {
        if (!user?.id) return; // Guard clause

        const { data, error } = await supabase.from('chats')
            .select('*')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false })

        if (error) {
            console.error(error.message);
            return;
        }

        setChats(data || []);
    }

    // Add useEffect to call fetchChats
    useEffect(() => {
        fetchChats();
    }, [user?.id]); // Re-fetch when user changes

    // You can get the `c` query param from the current URL using the `useSearchParams` hook from 'next/navigation'.
    // For client components (which this is - as you have 'use client' at the top), do:

    const searchParams = useSearchParams();
    const chatIdParam = searchParams.get('c');

    return (
        <Sidebar className="h-full w-[20%]" variant="inset" >
            <SidebarHeader>
                <div className="text-4xl font-semibold cursor-pointer flex justify-between">
                    <Link href={'/'}>Pluto AI</Link>
                    <UserButton />
                </div>
                <SidebarSeparator />
            </SidebarHeader>
            <SidebarContent className="p-3 w-[100%]">
                <SidebarMenu>
                    {chats.map((chat: any) => (
                        <Link href={`?c=${chat.id}`} key={chat.id}>
                            <SidebarMenuItem className={`p-4 border rounded-lg border-gray-300 cursor-pointer hover:bg-primary hover:text-white ${chatIdParam === chat.id && ' bg-primary text-white'}`}>
                                {chat.title}
                                <Trash2 size={16} className="mt-2" onClick={async () => {
                                    const { error } = await supabase.from('chats').delete().eq('id', chat.id);
                                    if (error) throw error.message;
                                    fetchChats();
                                }} />
                            </SidebarMenuItem>
                        </Link>
                    ))}
                </SidebarMenu>
            </SidebarContent>
        </Sidebar>
    )
}

export default AppSidebar;